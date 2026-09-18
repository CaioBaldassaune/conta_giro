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
