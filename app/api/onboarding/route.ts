import { acessos, fail, identity, sameOrigin } from "@/lib/server";
import { DomainError, mesApuracao, mesAtual, requireThat } from "@/lib/domain";
import { cnpjValido, PLANOS, type Plano } from "@/lib/onboarding";
import { clienteAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Entrada de novos clientes (5 etapas). Cada etapa é validada aqui no servidor; a gravação usa
// a chave de serviço porque o cliente ainda não tem vínculo com a empresa (o RLS o bloquearia).
// Por isso as regras de quem pode fazer o quê estão todas explícitas abaixo.

/** Escritório que recebe os novos clientes: ONBOARDING_ESCRITORIO_ID ou o único cadastrado. */
async function escritorioDeEntrada(admin: ReturnType<typeof clienteAdmin>) {
  const fixo = process.env.ONBOARDING_ESCRITORIO_ID;
  if (fixo) return fixo;
  const { data } = await admin.from("escritorios").select("id").limit(2);
  requireThat(data?.length === 1, "Defina ONBOARDING_ESCRITORIO_ID: há mais de um escritório cadastrado.", 500);
  return data[0].id as string;
}

export async function GET() {
  try {
    const { sb, u } = await identity();
    const a = await acessos(sb, u.id);
    const admin = clienteAdmin();
    const { data: ob } = await admin.from("onboardings").select("*").eq("usuario_id", u.id).maybeSingle();
    const escritorioId = ob?.escritorio_id ?? await escritorioDeEntrada(admin);
    const [{ data: serpro }, { data: empresa }] = await Promise.all([
      admin.from("integracoes_serpro").select("cnpj_contratante").eq("escritorio_id", escritorioId).maybeSingle(),
      ob?.empresa_id ? admin.from("empresas").select("razao_social, cnpj, municipio, plano").eq("id", ob.empresa_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    // "É da equipe?" pela função própria (independe do segundo fator): a equipe não usa o cadastro de clientes.
    const { data: equipe } = await sb.rpc("sou_equipe");
    return Response.json({
      usuario: { email: u.email, nome: u.displayName },
      equipe: !!equipe,
      // Já é cliente por convite (sem passar pela entrada): vai direto ao portal.
      jaCliente: !ob && a.empresasCliente.size > 0,
      onboarding: ob, empresa, cnpjEscritorio: serpro?.cnpj_contratante ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { sb, u } = await identity();
    const { data: equipe } = await sb.rpc("sou_equipe");
    requireThat(!equipe, "Esta entrada é para clientes. Use outro e-mail para se cadastrar como cliente.", 403);
    const d = await request.json();
    const admin = clienteAdmin();
    const { data: ob } = await admin.from("onboardings").select("*").eq("usuario_id", u.id).maybeSingle();
    const agora = new Date().toISOString();

    if (d.etapa === 1) {
      requireThat(!ob?.empresa_id, "A empresa já foi cadastrada nesta entrada.");
      const cnpj = String(d.cnpj ?? "").replace(/\D/g, "");
      requireThat(cnpjValido(cnpj), "CNPJ inválido: confira os números.");
      const razao = String(d.razaoSocial ?? "").trim();
      requireThat(razao.length >= 2 && razao.length <= 180, "Informe a razão social.");
      const municipio = String(d.municipio ?? "").trim();
      requireThat(municipio.length >= 3, "Informe o município / UF.");
      const uf = String(d.uf ?? "").trim().toUpperCase();
      requireThat(/^[A-Z]{2}$/.test(uf), "Informe a UF.");
      const ibge = String(d.codigoIbge ?? "").replace(/\D/g, "");
      const cep = String(d.cep ?? "").replace(/\D/g, "");
      const responsavel = String(d.responsavelNome ?? "").trim();
      requireThat(responsavel.length >= 3, "Informe o nome do responsável.");

      const escritorioId = await escritorioDeEntrada(admin);
      // Empresa já na carteira: não duplica; o cliente pede o convite ao escritório.
      const { data: existente } = await admin.from("empresas").select("id").eq("escritorio_id", escritorioId).eq("cnpj", cnpj).maybeSingle();
      requireThat(!existente, "Esta empresa já é cliente do escritório. Peça o convite de acesso ao seu contador.", 409);

      const empresaId = crypto.randomUUID();
      const texto = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max) || null;
      const { error } = await admin.from("empresas").insert({
        id: empresaId, escritorio_id: escritorioId, razao_social: razao, nome_fantasia: texto(d.nomeFantasia, 180), cnpj, municipio, uf,
        codigo_ibge: /^\d{7}$/.test(ibge) ? ibge : null, email: texto(d.email, 180) ?? u.email, telefone: texto(d.telefone, 30),
        cep: cep.length === 8 ? cep : null, logradouro: texto(d.logradouro, 125), numero: texto(d.numero, 10), complemento: texto(d.complemento, 60),
        bairro: texto(d.bairro, 60), origem: "autocadastro", demonstracao: false,
      });
      if (error) throw new DomainError(`Não foi possível cadastrar a empresa: ${error.message}`, 500);
      // Vínculo do cliente como sócio (acesso completo à própria empresa, nunca ao escritório).
      await admin.from("membros_empresa").insert({ empresa_id: empresaId, usuario_id: u.id, papel: "socio" });
      // Mês em apuração (anterior) e mês corrente, como na empresa criada pelo contador.
      await admin.from("competencias").insert([mesApuracao(), mesAtual()].map((competencia) => ({ empresa_id: empresaId, competencia })));
      // Aviso na central de chamados do escritório: novo cliente aguardando a grade tributária.
      await admin.from("solicitacoes").insert({
        empresa_id: empresaId, competencia: mesAtual(), titulo: "Novo cliente pelo site: configurar a grade tributária",
        descricao: `${razao} (CNPJ ${cnpj}) concluiu o cadastro pela página inicial. Responsável: ${responsavel}. Confira a procuração no e-CAC e confirme a matriz tributária (etapa 5).`,
        tipo: "Entrada de cliente", solicitado_por: u.id, solicitado_por_email: u.email,
      });
      await admin.from("registros_auditoria").insert({ empresa_id: empresaId, ator_id: u.id, ator_email: u.email, acao: "autocadastro", detalhe: `Empresa cadastrada pelo próprio cliente na página inicial (${responsavel}).` });
      await admin.from("onboardings").upsert({
        usuario_id: u.id, empresa_id: empresaId, escritorio_id: escritorioId, etapa: 2,
        responsavel_nome: responsavel.slice(0, 120), responsavel_telefone: texto(d.telefone, 30), atualizado_em: agora,
      });
      return Response.json({ etapa: 2, message: "Empresa cadastrada." });
    }

    requireThat(ob?.empresa_id, "Comece pela etapa 1: cadastro da empresa.");

    if (d.etapa === 2) {
      const plano = String(d.plano ?? "") as Plano;
      requireThat(plano in PLANOS, "Escolha um dos planos.");
      await admin.from("empresas").update({ plano }).eq("id", ob.empresa_id);
      await admin.from("onboardings").update({ plano, etapa: Math.max(ob.etapa, 3), atualizado_em: agora }).eq("usuario_id", u.id);
      return Response.json({ etapa: 3, message: `Plano ${PLANOS[plano].nome} escolhido.` });
    }

    if (d.etapa === 3) {
      // Pagamento e contrato em espera: registra só o aceite dos termos de uso.
      requireThat(d.aceite === true, "Aceite os termos de uso para continuar.");
      await admin.from("onboardings").update({ aceite_termos_em: agora, etapa: Math.max(ob.etapa, 4), atualizado_em: agora }).eq("usuario_id", u.id);
      return Response.json({ etapa: 4, message: "Termos aceitos." });
    }

    if (d.etapa === 4) {
      requireThat(d.procuracao === true, "Confirme que outorgou a procuração no e-CAC.");
      await admin.from("onboardings").update({ procuracao_informada_em: agora, etapa: 5, atualizado_em: agora }).eq("usuario_id", u.id);
      await admin.from("registros_auditoria").insert({ empresa_id: ob.empresa_id, ator_id: u.id, ator_email: u.email, acao: "procuracao_informada", detalhe: "Cliente informou que outorgou a procuração no e-CAC ao escritório." });
      return Response.json({ etapa: 5, message: "Tudo pronto! Você já pode usar o aplicativo.", destino: "/cliente" });
    }

    throw new DomainError("Etapa inválida.");
  } catch (e) {
    return fail(e);
  }
}
