import { createBrowserClient } from "@supabase/ssr";

// Cliente Supabase para componentes do navegador (login, cadastro, sair).
export function criarClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
