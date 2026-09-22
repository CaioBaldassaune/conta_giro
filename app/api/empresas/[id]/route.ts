import { acessos, fail, identity, sameOrigin } from "@/lib/server";
import { requireThat } from "@/lib/domain";
import { erroDoBanco } from "@/lib/repositorio";

// Atualiza dados cadastrais usados nas integrações (o CNPJ é obrigatório para o SERPRO).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const { sb, u } = await identity();
    // Cadastro da empresa: só a equipe do escritório altera (o RLS também exige).
    requireThat((await acessos(sb, u.id)).escritorios.length, "Somente a equipe do escritório altera o cadastro da empresa.", 403);
    const dados = await request.json();
    const alteracao: Record<string, unknown> = {};
    if (dados.cnpj !== undefined) {
      const cnpj = String(dados.cnpj).replace(/\D/g, "");
      requireThat(cnpj.length === 14, "CNPJ deve ter 14 dígitos.");
      alteracao.cnpj = cnpj;
    }
    if (dados.razaoSocial !== undefined) {
      const nome = String(dados.razaoSocial).trim();
      requireThat(nome.length >= 2 && nome.length <= 180, "Razão social inválida.");
      alteracao.razao_social = nome;
    }
    if (dados.municipio !== undefined) alteracao.municipio = String(dados.municipio).trim() || null;
    requireThat(Object.keys(alteracao).length, "Nada para atualizar.");
    // O RLS só permite a equipe do escritório responsável.
    const { data, error } = await sb.from("empresas").update(alteracao).eq("id", (await params).id).select("id");
    if (error) throw erroDoBanco(error);
    requireThat(data?.length, "Empresa não encontrada ou sem permissão.", 404);
    return Response.json({ message: "Cadastro da empresa atualizado." }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
