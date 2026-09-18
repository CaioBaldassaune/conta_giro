import { fail, getState, portalDe, sameOrigin } from "@/lib/server";
import { requireThat } from "@/lib/domain";
import { emitirNota } from "@/lib/nfse/emissao";
import { clienteAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Emite a NFS-e de um rascunho na Sefin Nacional.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { empresaId, notaId, period } = await request.json();
    requireThat(typeof empresaId === "string" && typeof notaId === "string", "Informe empresa e nota.");
    const r = await emitirNota(clienteAdmin(), empresaId, notaId);
    const ambiente = r.ambiente === "producao" ? "produção" : "produção restrita (sem valor fiscal)";
    const alertas = r.alertas.length ? ` Alertas: ${r.alertas.map((a) => `${a.codigo} ${a.descricao}`).join("; ")}` : "";
    return Response.json({
      state: await getState(portalDe(request), empresaId, period),
      message: `NFS-e ${r.numeroNfse} autorizada em ${ambiente}.${r.danfse ? " XML e DANFSe" : " XML"} arquivados em Documentos.${alertas}`,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
