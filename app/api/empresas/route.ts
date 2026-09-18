import { acessos, fail, identity, sameOrigin } from "@/lib/server";
import { requireThat } from "@/lib/domain";
import { criarEmpresa } from "@/lib/empresas";

// Inclui uma empresa na carteira do escritório do contador logado.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const dados = await request.json();
    const { sb, u } = await identity();
    const a = await acessos(sb, u.id);
    requireThat(a.escritorios.length, "Crie o escritório antes de cadastrar empresas.", 403);
    const id = await criarEmpresa(sb, u.id, a.escritorios[0], {
      razaoSocial: String(dados.razaoSocial ?? ""), cnpj: dados.cnpj, municipio: dados.municipio, email: dados.email,
    });
    return Response.json({ id, message: "Empresa incluída na carteira. Confirme a matriz tributária antes das notas." }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
