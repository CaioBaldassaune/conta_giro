import { comRetentativa, context, persist, getState, portalDe, sameOrigin, fail, type Portal } from "@/lib/server";
import { requireThat, getPeriod } from "@/lib/domain";
import { dre, dreLines, csv, dominioText, trialBalance } from "@/lib/reporting";
import { caminhoDocumento, enviarArquivo, removerArquivo, sha256 } from "@/lib/arquivos";
import { ConflitoDeVersao } from "@/lib/repositorio";

const brl = (v: number) => (v / 100).toFixed(2).replace(".", ",");

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const a = await request.json();
    const portal: Portal = portalDe(request, a.portal);
    const id = crypto.randomUUID();
    let caminho = "";
    const ctxFinal = await comRetentativa(async () => {
      const ctx = await context(a.companyId);
      requireThat(["accountant", "owner", "finance"].includes(ctx.role), "Seu perfil não permite exportação.", 403);
      requireThat(getPeriod(ctx.records, a.period), "Competência indisponível.");
      let content = "", name = "", mime = "text/csv;charset=utf-8";
      if (a.format === "dre") {
        const d = dre(ctx.records, a.period);
        content = csv([["ContaGiro • DRE gerencial em regime de caixa", ctx.company.name, a.period], ["Situação", d.closed ? "Mês enviado / fechado" : "Prévia em preparação"], ["Pendências", d.pending], ["Linha", "Valor (R$)"], ...dreLines.map(([k, label]) => [label, brl(d.values[k])]), ["Outras entradas pendentes excluídas", brl(d.excluded)]]);
        name = `Contagiro_DRE_Caixa_${a.period}.csv`;
      } else {
        requireThat(ctx.role === "accountant", "Exportação contábil restrita ao contador.", 403);
        if (a.format === "dominio") {
          content = dominioText(ctx.company, ctx.records, a.period);
          name = `Contagiro_Dominio_${a.period}.txt`;
          mime = "text/plain;charset=utf-8";
        } else {
          requireThat(a.format === "trial", "Formato inválido.");
          const b = trialBalance(ctx.records, a.period);
          content = csv([["Balancete de trabalho • conferir completude", ctx.company.name, a.period], ["Código", "Conta", "Grupo", "Saldo inicial", "Débitos", "Créditos", "Saldo final"], ...b.balances.map((r) => [r.code, r.name, r.group, ...[r.opening, r.debit, r.credit, r.closing].map(brl)])]);
          name = `Contagiro_Balancete_${a.period}.csv`;
        }
      }
      const bytes = new TextEncoder().encode(content), hash = await sha256(bytes), now = new Date().toISOString();
      if (!caminho) {
        caminho = caminhoDocumento(ctx.escritorioId, ctx.company.id, id);
        await enviarArquivo(ctx.sb, caminho, bytes, mime);
      }
      try {
        await persist(ctx, {
          upserts: [
            { id, kind: "document", period: a.period, data: { name, category: "other", key: caminho, size: bytes.byteLength, mime, sha256: hash, version: 1, uploadedAt: now, uploadedBy: ctx.u.email, sourceVersion: ctx.company.version, exportType: a.format } },
            { id: crypto.randomUUID(), kind: "document_event", period: a.period, data: { documentId: id, event: "generated", actor: ctx.u.email, actorId: ctx.u.id, at: now, detail: "Relatório gerado e preservado nesta competência." } },
          ],
          event: "export_generated",
          detail: `${name} gerado a partir da versão ${ctx.company.version}.`,
        });
      } catch (e) {
        if (!(e instanceof ConflitoDeVersao)) await removerArquivo(ctx.sb, caminho);
        throw e;
      }
      return ctx;
    });
    return Response.json({ state: await getState(portal, ctxFinal.company.id, a.period), url: `/api/documents?company=${encodeURIComponent(ctxFinal.company.id)}&id=${encodeURIComponent(id)}`, message: "Arquivo gerado e arquivado em Documentos." }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
