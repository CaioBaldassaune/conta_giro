// Cliente do Supabase no servidor com a sessão do usuário (cookies): as consultas respeitam o RLS.
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { CABECALHO_PORTAL, COOKIE_SESSAO, exigirConfiguracaoSupabase } from "./config";

// Cliente Supabase para Server Components e Route Handlers. Usa a sessão do
// usuário (cookies), então todo acesso ao banco passa pelo RLS.
export async function criarClienteServidor() {
  const { url, chave } = exigirConfiguracaoSupabase();
  const cookieStore = await cookies();
  // Qual sessão usar vem do proxy (contador ou cliente); sem ele, a do cliente (menor poder).
  const portal = (await headers()).get(CABECALHO_PORTAL) === "contador" ? "contador" : "cliente";
  return createServerClient(
    url,
    chave,
    {
      cookieOptions: { name: COOKIE_SESSAO[portal] },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components não gravam cookies; o proxy.ts renova a sessão.
          }
        },
      },
    },
  );
}

export type ClienteSupabase = Awaited<ReturnType<typeof criarClienteServidor>>;
