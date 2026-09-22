import { context, fail, sameOrigin } from "@/lib/server";
import { sincronizarEmpresa } from "@/lib/openfinance-servico";
import { clienteAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Busca D+1: importa o extrato pendente até ontem de todas as contas conectadas da empresa.
// Chamada ao abrir Movimentações (automático) ou pelo botão "Sincronizar agora".
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { empresaId } = await request.json();
    const ctx = await context(String(empresaId ?? ""));
    const r = await sincronizarEmpresa(clienteAdmin(), ctx);
    const message = r.importados ? `${r.importados} movimentação(ões) nova(s) do Open Finance para categorizar.` : "Extrato em dia: nenhuma movimentação nova.";
    return Response.json({ ...r, message }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
