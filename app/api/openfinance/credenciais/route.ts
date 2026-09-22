import { fail, identity, sameOrigin } from "@/lib/server";
import { DomainError, requireThat } from "@/lib/domain";
import { clienteAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Credenciais da Software House (escritório) na TecnoSpeed: CNPJ + token. O token vai para o
// Vault e nunca volta para a tela. Somente o titular do escritório altera.
async function meuEscritorio(sb: Awaited<ReturnType<typeof identity>>["sb"], usuarioId: string) {
  const { data } = await sb.from("membros_escritorio").select("escritorio_id, papel").eq("usuario_id", usuarioId).limit(1).maybeSingle();
  requireThat(data, "Área exclusiva da equipe do escritório.", 403);
  return { id: data.escritorio_id as string, titular: data.papel === "titular" };
}

export async function GET() {
  try {
    const { sb, u } = await identity();
    const escritorio = await meuEscritorio(sb, u.id);
    const { data } = await sb.from("integracoes_openfinance").select("ambiente, cnpj_sh, ativa, atualizado_em").eq("escritorio_id", escritorio.id).maybeSingle();
    return Response.json({ titular: escritorio.titular, configuracao: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { sb, u } = await identity();
    const escritorio = await meuEscritorio(sb, u.id);
    requireThat(escritorio.titular, "Somente o titular do escritório configura a integração.", 403);
    const d = await request.json();
    const ambiente = d.ambiente === "producao" ? "producao" : "staging";
    const cnpjSh = String(d.cnpjSh ?? "").replace(/\D/g, "");
    const tokenSh = String(d.tokenSh ?? "").trim();
    requireThat(cnpjSh.length === 14, "CNPJ da Software House (escritório) deve ter 14 dígitos.");
    requireThat(tokenSh.length >= 8 && tokenSh.length <= 500, "Informe o token da Software House (portal de contas da TecnoSpeed).");

    const admin = clienteAdmin();
    const { data: anterior } = await admin.from("integracoes_openfinance").select("token_segredo_id").eq("escritorio_id", escritorio.id).maybeSingle();
    const { data: segredo, error } = await admin.rpc("cofre_guardar", { p_valor: tokenSh, p_nome: `openfinance-token-${escritorio.id}-${Date.now()}` });
    if (error || !segredo) throw new DomainError("Não foi possível guardar o token no cofre.", 500);
    await admin.from("integracoes_openfinance").upsert({ escritorio_id: escritorio.id, ambiente, cnpj_sh: cnpjSh, token_segredo_id: segredo, ativa: true, atualizado_por: u.id, atualizado_em: new Date().toISOString() });
    if (anterior?.token_segredo_id) await admin.rpc("cofre_apagar", { p_id: anterior.token_segredo_id });
    return Response.json({ message: `Integração Open Finance salva (${ambiente === "producao" ? "produção" : "homologação"}).` }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
