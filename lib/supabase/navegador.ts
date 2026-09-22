// Cliente do Supabase no navegador (chave pública): só login e sessão; os dados passam pelas
// rotas /api, e o RLS vale mesmo se alguém chamar o Supabase direto.
import { createBrowserClient } from "@supabase/ssr";
import { COOKIE_SESSAO, exigirConfiguracaoSupabase, type Portal } from "./config";

// Cliente Supabase para componentes do navegador (login, cadastro, sair), sempre de UM portal:
// a sessão do contador e a do cliente ficam em cookies diferentes. isSingleton=false porque o
// padrão da biblioteca reaproveitaria o primeiro cliente criado, misturando as sessões.
export function criarClienteNavegador(portal: Portal) {
  const { url, chave } = exigirConfiguracaoSupabase();
  return createBrowserClient(url, chave, { cookieOptions: { name: COOKIE_SESSAO[portal] }, isSingleton: false });
}
