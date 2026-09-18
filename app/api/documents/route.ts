import { comRetentativa, context, fail, getState, persist, portalDe, sameOrigin, type Portal } from "@/lib/server";
import { getPeriod, requireThat, textField, type Entry } from "@/lib/domain";
import { baixarArquivo, caminhoDocumento, enviarArquivo, removerArquivo, sha256 } from "@/lib/arquivos";
import { idBanco } from "@/lib/traducao";
import { ConflitoDeVersao } from "@/lib/repositorio";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    requireThat(Number(request.headers.get("content-length") || 0) <= 10_200_000, "Limite de 10 MB por documento.", 413);
    const form = await request.formData(), file = form.get("file");
    requireThat(file instanceof File && file.size > 0 && file.size <= 10_000_000, "Selecione um arquivo de até 10 MB.");
    const companyId = textField(form.get("companyId"), "Empresa"), category = textField(form.get("category"), "Categoria"), selectedPeriod = textField(form.get("period"), "Competência", 7);
    const portal: Portal = portalDe(request, form.get("portal"));

    const bytes = await file.arrayBuffer(), b = new Uint8Array(bytes), signature = new TextDecoder().decode(b.slice(0, 5));
    const mime = signature === "%PDF-" ? "application/pdf" : b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? "image/png" : null;
    requireThat(mime, "Use PDF, JPG ou PNG.");
    const hash = await sha256(bytes);
    const id = crypto.randomUUID();

    let caminho = "";
    await comRetentativa(async () => {
      const ctx = await context(companyId);
      requireThat(["accountant", "owner", "finance"].includes(ctx.role), "Seu perfil não pode anexar estes documentos.", 403);
      requireThat(["monthly", "invoice", "tax", "other", "corporate", "people", "payroll", "notification"].includes(category), "Categoria inválida.");
      requireThat(category !== "people" || ["owner", "accountant"].includes(ctx.role), "Documentos pessoais têm acesso restrito ao administrador e contador.", 403);
      const permanent = ["corporate", "people"].includes(category), period = permanent ? "permanent" : selectedPeriod, p = getPeriod(ctx.records, selectedPeriod);
      requireThat(p, "Competência indisponível.");
      requireThat(permanent || p.data.status === "open" || ctx.role === "accountant", "Reabra o mês para acrescentar documentos à base.");
      const previousId = String(form.get("previousId") || "");
      const previous = previousId ? ctx.records.find((r) => r.id === previousId && r.kind === "document") : null;
      requireThat(!previousId || previous && previous.period === period && previous.data.category === category, "A nova versão deve permanecer na pasta e competência do original.");
      requireThat(!previous || !ctx.records.some((r) => r.kind === "document" && r.data.previousId === previous.id), "Selecione a versão mais recente do documento para criar a próxima versão.");

      // O arquivo é enviado uma única vez, mesmo se a gravação precisar ser refeita.
      if (!caminho) {
        caminho = caminhoDocumento(ctx.escritorioId, companyId, id);
        await enviarArquivo(ctx.sb, caminho, bytes, mime);
      }
      const now = new Date().toISOString();
      const name = file.name.replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(0, 180);
      const data = { name, category, key: caminho, size: file.size, mime, uploadedAt: now, uploadedBy: ctx.u.email, sha256: hash, version: previous ? (previous.data.version || 1) + 1 : 1, previousId: previous?.id || null, acknowledgments: [], scope: permanent ? "permanent" : "monthly" };
      const entries: Entry[] = [
        { id, kind: "document", period, data },
        { id: crypto.randomUUID(), kind: "document_event", period, data: { documentId: id, event: "uploaded", actor: ctx.u.email, actorId: ctx.u.id, at: now, detail: `Arquivo v${data.version} disponível no portal. SHA-256: ${hash}.` } },
      ];
      if (["tax", "notification", "payroll"].includes(category)) entries.push({ id: crypto.randomUUID(), kind: "notification", period: selectedPeriod, data: { title: `Documento disponível: ${name}`, body: "A contabilidade disponibilizou este documento. Abra o arquivo e confirme sua ciência.", documentId: id, createdAt: now, channel: "portal", readBy: [], audience: "client" } });
      try {
        await persist(ctx, { upserts: entries, event: "document_upload", detail: `Documento ${name}, v${data.version}, anexado em ${period}. Original preservado.` });
      } catch (e) {
        if (!(e instanceof ConflitoDeVersao)) await removerArquivo(ctx.sb, caminho);
        throw e;
      }
    });
    return Response.json({ state: await getState(portal, companyId, selectedPeriod), message: "Documento armazenado com identificação, versão e histórico." }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url), ctx = await context(url.searchParams.get("company") || "");
    const doc = ctx.records.find((r) => r.id === url.searchParams.get("id") && r.kind === "document");
    requireThat(doc && (ctx.role !== "issuer" || doc.data.category === "invoice") && (doc.data.category !== "people" || ["owner", "accountant"].includes(ctx.role)), "Documento indisponível para este acesso.", 404);
    const arquivo = await baixarArquivo(ctx.sb, doc.data.key);
    const now = new Date().toISOString(), inline = url.searchParams.get("view") === "1" && ["application/pdf", "image/png", "image/jpeg"].includes(doc.data.mime);
    const detail = `${inline ? "Abertura" : "Download"} solicitado: ${doc.data.name}, v${doc.data.version || 1}. Não comprova leitura.`;
    // Eventos somente de inclusão: não alteram a versão da empresa.
    await Promise.all([
      ctx.sb.from("eventos_documento").insert({ documento_id: idBanco(doc.id), empresa_id: ctx.company.id, evento: inline ? "abertura_solicitada" : "download_solicitado", ator_id: ctx.u.id, ator_email: ctx.u.email, detalhe: detail, ocorrido_em: now }),
      ctx.sb.from("registros_auditoria").insert({ empresa_id: ctx.company.id, ator_id: ctx.u.id, ator_email: ctx.u.email, acao: "document_access_requested", detalhe: detail }),
    ]);
    return new Response(arquivo.stream(), { headers: { "Content-Type": doc.data.mime, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.data.name)}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'" } });
  } catch (e) {
    return fail(e);
  }
}
