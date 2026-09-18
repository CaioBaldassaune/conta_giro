import { createBrowserClient } from "@supabase/ssr";
import { exigirConfiguracaoSupabase } from "./config";

// Cliente Supabase para componentes do navegador (login, cadastro, sair).
export function criarClienteNavegador() {
  const { url, chave } = exigirConfiguracaoSupabase();
  return createBrowserClient(url, chave);
}
