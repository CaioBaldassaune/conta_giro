import { comRetentativa, context, fail, persist, sameOrigin } from "@/lib/server";
import { getPeriod, requireThat, type Entry } from "@/lib/domain";
import { caminhoDocumento, enviarArquivo, sha256 } from "@/lib/arquivos";
import { carregarCredenciais } from "@/lib/serpro";
import { gerarDas } from "@/lib/serpro-servicos";
import { clienteAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Gera o DAS no SERPRO e publica o PDF nos documentos do cliente (com aviso no portal).
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { empresaId, competencia } = await request.json();
    requireThat(/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia), "Competência inválida.");
    const ctx = await context(empresaId);
    requireThat(ctx.role === "accountant", "Somente a equipe do escritório gera o DAS.", 403);
    requireThat(ctx.company.data.cnpj, "Cadastre o CNPJ da empresa antes de gerar o DAS.");
    requireThat(getPeriod(ctx.records, competencia), "Abra a competência antes de gerar o DAS.");

    const admin = clienteAdmin();
    const cred = await carregarCredenciais(admin, ctx.escritorioId);
    const das = await gerarDas(admin, cred, ctx.company.data.cnpj, competencia, { empresaId, usuarioId: ctx.u.id });

    const bytes = Buffer.from(das.pdfBase64, "base64");
    const id = crypto.randomUUID();
    const caminho = caminhoDocumento(ctx.escritorioId, empresaId, id);
    await enviarArquivo(ctx.sb, caminho, bytes, "application/pdf");
    const hash = await sha256(bytes);
    const nome = `DAS_${competencia}${das.numeroDocumento ? `_${das.numeroDocumento}` : ""}.pdf`;
    const valor = das.valorTotal != null ? (das.valorTotal / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "valor no documento";
    const vencimento = das.vencimento ? das.vencimento.split("-").reverse().join("/") : "ver documento";

    await comRetentativa(async () => {
      const atual = await context(empresaId);
      const now = new Date().toISOString();
      const entradas: Entry[] = [
        { id, kind: "document", period: competencia, data: { name: nome, category: "tax", key: caminho, size: bytes.byteLength, mime: "application/pdf", sha256: hash, version: 1, uploadedAt: now, uploadedBy: atual.u.email, acknowledgments: [], scope: "monthly" } },
        { id: crypto.randomUUID(), kind: "document_event", period: competencia, data: { documentId: id, event: "generated", actor: atual.u.email, actorId: atual.u.id, at: now, detail: "DAS emitido pelo SERPRO Integra Contador (PGDASD/GERARDAS12)." } },
        { id: crypto.randomUUID(), kind: "notification", period: competencia, data: { title: `DAS de ${competencia} disponível`, body: `Valor: ${valor} • Vencimento: ${vencimento}. Abra o documento para pagar e confirme sua ciência.`, documentId: id, createdAt: now, channel: "portal", readBy: [], audience: "client" } },
      ];
      await persist(atual, { upserts: entradas, event: "das_emitido", detail: `${nome} emitido pelo SERPRO (${valor}, vencimento ${vencimento}).` });
    });
    await admin.from("situacoes_fiscais").upsert(
      { empresa_id: empresaId, competencia, das_valor: das.valorTotal, das_vencimento: das.vencimento, das_pago: false, atualizado_em: new Date().toISOString() },
      { onConflict: "empresa_id,competencia" },
    );

    return Response.json({ message: `DAS gerado (${valor}, vencimento ${vencimento}) e publicado para o cliente.`, documentoId: id }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
