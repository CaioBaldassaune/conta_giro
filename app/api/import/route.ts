import { comRetentativa, context, fail, getState, persist, portalDe, sameOrigin, type Portal } from "@/lib/server";
import { allowed, getPeriod, normalize, requireThat, textField, type Entry } from "@/lib/domain";
import { parseStatement, suggestedCategory } from "@/lib/importer";
import { caminhoDocumento, enviarArquivo, removerArquivo, sha256 } from "@/lib/arquivos";
import { ConflitoDeVersao } from "@/lib/repositorio";
import { idBanco } from "@/lib/traducao";

const digest = (value: string) => sha256(new TextEncoder().encode(value));

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    requireThat(Number(request.headers.get("content-length") || 0) <= 2_200_000, "Limite de 2 MB por importação.", 413);
    const form = await request.formData(), file = form.get("file");
    requireThat(file instanceof File && file.size > 0 && file.size <= 2_000_000, "Selecione um OFX ou CSV de até 2 MB.");
    requireThat(/\.(csv|ofx)$/i.test(file.name), "Formato não suportado. Use OFX ou CSV.");
    const companyId = textField(form.get("companyId"), "Empresa"), account = textField(form.get("account"), "Conta bancária", 80), period = textField(form.get("period"), "Competência", 7);
    const portal: Portal = portalDe(request, form.get("portal"));
    const bytes = await file.arrayBuffer(), hash = await sha256(bytes);
    let content = new TextDecoder("utf-8").decode(bytes);
    if (content.includes("�")) content = new TextDecoder("windows-1252").decode(bytes);
    const rows = parseStatement(content, file.name);
    requireThat(rows.every((r) => r.date.startsWith(period)), "O arquivo contém movimentos de outra competência. Importe um mês por vez.");
    const documentId = crypto.randomUUID();
    let caminho = "";

    const resultado = await comRetentativa(async () => {
      const ctx = await context(companyId);
      requireThat(allowed(ctx.role, "classify"), "Seu perfil não pode importar extratos.", 403);
      const p = getPeriod(ctx.records, period);
      requireThat(!ctx.records.some((r) => r.kind === "accounting" && r.period === period && r.data.type === "close" && r.data.status === "reviewed"), "Reabra a revisão contábil antes de alterar o extrato.");
      requireThat(p?.data.status === "open", "A competência deve estar aberta para importar.");
      const accountKey = normalize(account), existing = ctx.records.filter((r) => r.kind === "transaction" && normalize(r.data.account) === accountKey);
      const signatures = new Set(existing.map((r) => `${r.data.date}|${r.data.amount}|${normalize(r.data.description)}`));
      const identified = await Promise.all(rows.map(async (r, i) => {
        const key = r.fitId ? `${companyId}|${accountKey}|fit:${r.fitId}` : `${companyId}|${accountKey}|file:${hash}|line:${i}`;
        return { ...r, id: `tx-${await digest(key)}`, suggestion: suggestedCategory(r, ctx.records), possibleDuplicate: r.possibleDuplicate || (!r.fitId && signatures.has(`${r.date}|${r.amount}|${normalize(r.description)}`)) };
      }));
      const unique = new Map<string, (typeof identified)[number]>();
      let repeated = 0;
      for (const row of identified) {
        // Os ids gravados no banco são a versão UUID do id calculado aqui.
        const prev = unique.get(row.id) || existing.find((e) => e.id === idBanco(row.id))?.data;
        if (prev) {
          requireThat(prev.date === row.date && prev.amount === row.amount, "O mesmo identificador bancário tem dados diferentes. Revise o arquivo.");
          repeated++;
        } else unique.set(row.id, row);
      }
      const newRows = [...unique.values()];
      if (form.get("commit") !== "true") return { preview: { rows: newRows, duplicates: repeated, count: newRows.length, hash, version: ctx.company.version, warning: newRows.some((r) => r.possibleDuplicate) ? "Há movimentos semelhantes. Eles serão mantidos com pendência para sua revisão." : null } };
      requireThat(newRows.length > 0, "Todos os lançamentos deste arquivo já foram importados.");
      const entries: Entry[] = newRows.map((r) => ({ id: r.id, kind: "transaction", period, data: { date: r.date, description: r.description, amount: r.amount, category: null, invoiceId: null, account, source: file.name.slice(0, 180), fileHash: hash, fitId: r.fitId, needsReview: r.possibleDuplicate } }));
      if (!caminho) {
        caminho = caminhoDocumento(ctx.escritorioId, companyId, documentId);
        await enviarArquivo(ctx.sb, caminho, bytes, "application/octet-stream");
      }
      entries.push({ id: documentId, kind: "document", period, data: { name: file.name.slice(0, 180), category: "bank", key: caminho, size: file.size, mime: "application/octet-stream", uploadedAt: new Date().toISOString(), sha256: hash, version: 1, uploadedBy: ctx.u.email } });
      entries.push({ ...p, data: { ...p.data, bankConfirmed: false, revenueConfirmed: false, lastBatch: null } });
      try {
        await persist(ctx, { upserts: entries, event: "import_statement", detail: `${newRows.length} lançamento(s) importados de ${file.name.slice(0, 180)}; ${repeated} duplicado(s) identificado(s) ignorados.` });
      } catch (e) {
        if (!(e instanceof ConflitoDeVersao)) await removerArquivo(ctx.sb, caminho);
        throw e;
      }
      return { count: newRows.length };
    });

    if ("preview" in resultado) return Response.json(resultado.preview, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ state: await getState(portal, companyId, period), message: `${resultado.count} lançamentos importados. Confirme as categorias sugeridas.` }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
