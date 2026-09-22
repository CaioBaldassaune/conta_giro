// As variáveis NEXT_PUBLIC_ são embutidas no build: precisam existir no ambiente
// (local: .env.local; Vercel: Environment Variables do ambiente certo) ANTES do build.
export const MENSAGEM_CONFIGURACAO_AUSENTE =
  "Configuração ausente: defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY " +
  "no ambiente deste deploy (Vercel → Settings → Environment Variables, marcando Preview) e gere um novo deploy.";

export function configuracaoSupabase(): { url: string; chave: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && chave ? { url, chave } : null;
}

export function exigirConfiguracaoSupabase() {
  const config = configuracaoSupabase();
  if (!config) throw new Error(MENSAGEM_CONFIGURACAO_AUSENTE);
  return config;
}

// ---------------------------------------------------------------------------
// Sessões separadas por portal. O acesso do escritório e o do cliente NUNCA se misturam:
// cada portal guarda a sessão num cookie próprio. Logado como contador, o navegador continua
// "deslogado" no site do cliente (e vice-versa), e uma sessão não serve na área da outra.
// ---------------------------------------------------------------------------
export type Portal = "contador" | "cliente";
export const COOKIE_SESSAO: Record<Portal, string> = { contador: "cg-sessao-contador", cliente: "cg-sessao-cliente" };
/** Cabeçalho que o proxy grava (e sobrescreve) em toda requisição, dizendo qual sessão usar. */
export const CABECALHO_PORTAL = "x-contagiro-portal";

/**
 * Portal de uma requisição: páginas /contador → contador; rotas /api herdam da página que as
 * chamou (Referer da mesma origem); todo o resto (site, /comecar, /cliente, convite) → cliente.
 * Na dúvida, "cliente": a sessão do cliente nunca tem poderes de escritório.
 */
export function portalDaRequisicao(caminho: string, referer: string | null, origem: string): Portal {
  if (caminho.startsWith("/contador")) return "contador";
  if (caminho.startsWith("/api/") && referer) {
    try {
      const r = new URL(referer);
      if (r.origin === origem && r.pathname.startsWith("/contador")) return "contador";
    } catch { /* referer inválido: cliente */ }
  }
  return "cliente";
}
