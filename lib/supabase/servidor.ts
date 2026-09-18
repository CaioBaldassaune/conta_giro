import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { exigirConfiguracaoSupabase } from "./config";

// Cliente Supabase para Server Components e Route Handlers. Usa a sessão do
// usuário (cookies), então todo acesso ao banco passa pelo RLS.
export async function criarClienteServidor() {
  const { url, chave } = exigirConfiguracaoSupabase();
  const cookieStore = await cookies();
  return createServerClient(
    url,
    chave,
    {
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
