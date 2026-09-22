import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { CABECALHO_PORTAL, COOKIE_SESSAO, configuracaoSupabase, MENSAGEM_CONFIGURACAO_AUSENTE, portalDaRequisicao } from "@/lib/supabase/config";

// Porta de entrada de toda requisição:
// 1) decide qual sessão vale (contador ou cliente — cookies separados, nunca se misturam) e
//    grava isso num cabeçalho interno, sobrescrevendo qualquer valor vindo do navegador;
// 2) renova a sessão daquele portal;
// 3) protege as páginas: /cliente exige login de cliente; /contador exige login de alguém da
//    EQUIPE e o segundo fator (código do aplicativo autenticador) validado nesta sessão.
// A autorização fina (qual empresa, qual papel) acontece no servidor e no RLS do banco, que
// também exige o segundo fator para qualquer poder de escritório.
export async function proxy(request: NextRequest) {
  const config = configuracaoSupabase();
  if (!config) {
    return new NextResponse(MENSAGEM_CONFIGURACAO_AUSENTE, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const { pathname } = request.nextUrl;
  const portal = portalDaRequisicao(pathname, request.headers.get("referer"), request.nextUrl.origin);
  const cabecalhos = new Headers(request.headers);
  cabecalhos.set(CABECALHO_PORTAL, portal);
  let response = NextResponse.next({ request: { headers: cabecalhos } });

  const supabase = createServerClient(config.url, config.chave, {
    cookieOptions: { name: COOKIE_SESSAO[portal] },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: cabecalhos } });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (pathname.startsWith("/api/")) return response;

  const ir = (destino: string) => {
    const url = request.nextUrl.clone();
    const [caminho, busca] = destino.split("?");
    url.pathname = caminho;
    url.search = busca ? `?${busca}` : "";
    const redirecionar = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirecionar.cookies.set(c));
    return redirecionar;
  };

  if (pathname.startsWith("/cliente") && !pathname.startsWith("/cliente/entrar") && !user) return ir("/cliente/entrar");

  if (pathname.startsWith("/contador")) {
    const entrada = pathname.startsWith("/contador/entrar");
    const cadastroFator = pathname.startsWith("/contador/seguranca");
    if (!user) return entrada ? response : ir("/contador/entrar");

    // Só a equipe do escritório usa esta área (a função responde só sobre a própria pessoa).
    const { data: equipe } = await supabase.rpc("sou_equipe");
    if (!equipe) {
      await supabase.auth.signOut();
      return ir("/contador/entrar?erro=sem-acesso");
    }

    // Segundo fator obrigatório: sem fator cadastrado → cadastrar; com fator → validar o código.
    const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (nivel?.currentLevel !== "aal2") {
      if (nivel?.nextLevel === "aal2") return entrada ? response : ir("/contador/entrar?etapa=codigo");
      return cadastroFator ? response : ir("/contador/seguranca");
    }
    if (entrada || cadastroFator) return ir("/contador");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand/|fonts/|favicon|.*\\.(?:svg|png|jpg|jpeg|ico|ttf|csv)$).*)"],
};
