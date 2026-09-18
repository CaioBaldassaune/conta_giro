import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Renova a sessão do Supabase a cada navegação e protege os dois portais.
// A autorização real (qual empresa, qual papel) acontece no servidor e no RLS.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
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
