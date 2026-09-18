import { fail, identity, sameOrigin } from "@/lib/server";
import { requireThat } from "@/lib/domain";
import { erroDoBanco } from "@/lib/repositorio";

export const dynamic = "force-dynamic";

// Configuração do emissor de NFS-e de uma empresa + dados do certificado ativo (sem segredos).
export async function GET(request: Request) {
  try {
    const { sb } = await identity();
    const empresaId = new URL(request.url).searchParams.get("empresa") ?? "";
    requireThat(empresaId, "Escolha uma empresa.");
    const [{ data: empresa }, { data: config }, { data: certificado }, { data: emitidas }] = await Promise.all([
      sb.from("empresas").select("id, razao_social, cnpj, municipio").eq("id", empresaId).maybeSingle(),
      sb.from("configuracoes_nfse").select("*").eq("empresa_id", empresaId).maybeSingle(),
      sb.from("certificados_digitais").select("cnpj, titular, valido_ate, criado_em").eq("empresa_id", empresaId).eq("situacao", "ativo").maybeSingle(),
      sb.from("notas_fiscais").select("numero, chave_acesso, ambiente, emitida_em, tomador_nome, valor_servicos").eq("empresa_id", empresaId).not("chave_acesso", "is", null).order("emitida_em", { ascending: false }).limit(10),
    ]);
    requireThat(empresa, "Empresa não encontrada.", 404);
    return Response.json({ empresa, configuracao: config, certificado, emitidas: emitidas ?? [], chaveServidorConfigurada: !!process.env.SUPABASE_SECRET_KEY }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

// Salva a configuração (somente a equipe do escritório; o RLS confere).
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { sb, u } = await identity();
    const d = await request.json();
    requireThat(typeof d.empresaId === "string", "Escolha uma empresa.");
    requireThat(["producao_restrita", "producao"].includes(d.ambiente), "Ambiente inválido.");
    requireThat(/^\d{1,5}$/.test(String(d.serie ?? "")), "Série: de 1 a 5 dígitos.");
    const proximo = Number(d.proximoNumero);
    requireThat(Number.isInteger(proximo) && proximo >= 1, "Próximo número da DPS inválido.");
    requireThat(/^\d{7}$/.test(String(d.codigoIbge ?? "")), "Código IBGE do município: 7 dígitos.");
    requireThat(["1", "2", "3"].includes(d.opSimples), "Situação no Simples Nacional inválida.");
    const regime = d.opSimples === "3" ? String(d.regimeApuracaoSN ?? "") : null;
    requireThat(d.opSimples !== "3" || ["1", "2", "3"].includes(regime!), "Informe o regime de apuração do Simples Nacional.");
    const percentual = d.percentualTributosSN === "" || d.percentualTributosSN == null ? null : Number(String(d.percentualTributosSN).replace(",", "."));
    requireThat(d.opSimples !== "3" || (percentual != null && percentual >= 0 && percentual < 100), "Para ME/EPP informe o percentual aproximado dos tributos do Simples Nacional (regra E0712).");
    requireThat(d.ambiente !== "producao" || d.confirmarProducao === true, "Para emitir em produção confirme que os testes na produção restrita foram concluídos.");

    const { error } = await sb.from("configuracoes_nfse").upsert({
      empresa_id: d.empresaId,
      ambiente: d.ambiente,
      serie_dps: String(d.serie),
      proximo_numero_dps: proximo,
      codigo_ibge_emissao: String(d.codigoIbge),
      inscricao_municipal: String(d.inscricaoMunicipal ?? "").trim() || null,
      op_simples_nacional: d.opSimples,
      regime_apuracao_sn: regime,
      regime_especial: "0",
      percentual_tributos_sn: percentual,
      ativa: !!d.ativa,
      atualizado_por: u.id,
      atualizado_em: new Date().toISOString(),
    });
    if (error) throw erroDoBanco(error);
    await sb.from("registros_auditoria").insert({ empresa_id: d.empresaId, ator_id: u.id, ator_email: u.email, acao: "nfse_configurada", detalhe: `Ambiente ${d.ambiente}, série ${d.serie}, próximo nº ${proximo}, ${d.ativa ? "ativa" : "inativa"}.` });
    return Response.json({ message: "Configuração da NFS-e salva." }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
