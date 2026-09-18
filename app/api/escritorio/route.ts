import { acessos, fail, identity, sameOrigin } from "@/lib/server";
import { requireThat } from "@/lib/domain";
import { criarEmpresa, EMPRESAS_DEMONSTRACAO } from "@/lib/empresas";
import { erroDoBanco } from "@/lib/repositorio";

// Cria o escritório do usuário logado (ele vira titular) e, se pedido,
// três empresas fictícias para explorar o sistema.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { nome, cnpj, demonstracao } = await request.json();
    const { sb, u } = await identity();
    const a = await acessos(sb, u.id);
    requireThat(!a.escritorios.length, "Você já participa de um escritório.", 409);
    requireThat(typeof nome === "string" && nome.trim().length >= 2, "Informe o nome do escritório.");

    const { data: escritorioId, error } = await sb.rpc("criar_escritorio", { p_nome: nome, p_cnpj: cnpj || null });
    if (error) throw erroDoBanco(error);
    if (demonstracao) {
      for (const [i, razaoSocial] of EMPRESAS_DEMONSTRACAO.entries()) await criarEmpresa(sb, u.id, escritorioId, { razaoSocial }, i);
    }
    return Response.json({ escritorioId }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
