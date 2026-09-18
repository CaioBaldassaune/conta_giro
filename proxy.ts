import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { configuracaoSupabase, MENSAGEM_CONFIGURACAO_AUSENTE } from "@/lib/supabase/config";

// Renova a sessão do Supabase a cada navegação e protege os dois portais.
// A autorização real (qual empresa, qual papel) acontece no servidor e no RLS.
export async function proxy(request: NextRequest) {
  const config = configuracaoSupabase();
  if (!config) {
    return new NextResponse(MENSAGEM_CONFIGURACAO_AUSENTE, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    config.url,
    config.chave,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;
  const portal = pathname.startsWith("/contador") ? "contador" : pathname.startsWith("/cliente") ? "cliente" : null;
  const paginaDeEntrada = pathname.endsWith("/entrar");

  if (portal && !user && !paginaDeEntrada) {
    const url = request.nextUrl.clone();
    url.pathname = `/${portal}/entrar`;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand/|fonts/|favicon|.*\\.(?:svg|png|jpg|jpeg|ico|ttf|csv)$).*)"],
};
