import "server-only";
import { createClient } from "@supabase/supabase-js";
import { DomainError } from "../domain";
import { exigirConfiguracaoSupabase } from "./config";

/**
 * Cliente com a chave secreta (service_role): ignora o RLS. Usado SOMENTE no
 * servidor para ler segredos do Vault e gravar dados vindos de integrações
 * (SERPRO). Nunca importar em componentes de navegador.
 */
export function clienteAdmin() {
  const chave = process.env.SUPABASE_SECRET_KEY;
  if (!chave) {
    throw new DomainError(
      "Integração indisponível: defina SUPABASE_SECRET_KEY (chave secreta do Supabase) no ambiente do servidor.",
      503,
    );
  }
  const { url } = exigirConfiguracaoSupabase();
  return createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type ClienteAdmin = ReturnType<typeof clienteAdmin>;
