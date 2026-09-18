import { fail, identity, sameOrigin } from "@/lib/server";
import { DomainError, requireThat } from "@/lib/domain";
import { exigirValido, lerCertificado } from "@/lib/certificado";
import { autenticar } from "@/lib/serpro";
import { clienteAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function meuEscritorio(sb: Awaited<ReturnType<typeof identity>>["sb"], usuarioId: string) {
  const { data } = await sb.from("membros_escritorio").select("escritorio_id, papel").eq("usuario_id", usuarioId).limit(1).maybeSingle();
  requireThat(data, "Área exclusiva da equipe do escritório.", 403);
  return { id: data.escritorio_id as string, titular: data.papel === "titular" };
}

// Situação da integração (sem segredos) e consumo do mês.
export async function GET() {
  try {
    const { sb, u } = await identity();
    const escritorio = await meuEscritorio(sb, u.id);
    const inicioMes = new Date();
    inicioMes.setUTCDate(1);
    inicioMes.setUTCHours(0, 0, 0, 0);
    const [{ data: cfg }, cobradas, total, ultimas] = await Promise.all([
      sb.from("integracoes_serpro").select("cnpj_contratante, titular_certificado, certificado_valido_ate, ativa, ultimo_teste_em, ultimo_teste_ok, atualizado_em").eq("escritorio_id", escritorio.id).maybeSingle(),
      sb.from("requisicoes_serpro").select("id", { count: "exact", head: true }).eq("escritorio_id", escritorio.id).eq("bilhetada", true).gte("criado_em", inicioMes.toISOString()),
      sb.from("requisicoes_serpro").select("id", { count: "exact", head: true }).eq("escritorio_id", escritorio.id).gte("criado_em", inicioMes.toISOString()),
      sb.from("requisicoes_serpro").select("id_sistema, id_servico, status_http, bilhetada, mensagem, criado_em, empresas(razao_social)").eq("escritorio_id", escritorio.id).order("criado_em", { ascending: false }).limit(15),
    ]);
    return Response.json({
      titular: escritorio.titular,
      chaveServidorConfigurada: !!process.env.SUPABASE_SECRET_KEY,
      configuracao: cfg,
      consumoMes: { cobradas: cobradas.count ?? 0, total: total.count ?? 0 },
      ultimas: ultimas.data ?? [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

// Recebe certificado e credenciais, testa a autenticação no SERPRO e só então grava no Vault.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { sb, u } = await identity();
    const escritorio = await meuEscritorio(sb, u.id);
    requireThat(escritorio.titular, "Somente o titular do escritório configura a integração.", 403);

    const form = await request.formData();
    const arquivo = form.get("certificado");
    const senha = String(form.get("senha") ?? "");
    const consumerKey = String(form.get("consumerKey") ?? "").trim();
    const consumerSecret = String(form.get("consumerSecret") ?? "").trim();
    requireThat(arquivo instanceof File && arquivo.size > 0 && arquivo.size <= 50_000, "Envie o certificado A1 (.pfx ou .p12).");
    requireThat(senha && consumerKey && consumerSecret, "Preencha a senha do certificado, a Consumer Key e o Consumer Secret.");

    const pfx = new Uint8Array(await arquivo.arrayBuffer());
    const certificado = lerCertificado(pfx, senha);
    exigirValido(certificado);
    requireThat(certificado.cnpj, "Use o certificado e-CNPJ do escritório (o mesmo usado na contratação do Integra Contador).");

    // Testa de verdade antes de gravar.
    try {
      await autenticar({ escritorioId: `teste:${escritorio.id}`, cnpjContratante: certificado.cnpj!, consumerKey, consumerSecret, certificado }, true);
    } catch (e) {
      throw e instanceof DomainError ? e : new DomainError(`Falha ao contatar o SERPRO: ${(e as Error).message}`, 502);
    }

    const admin = clienteAdmin();
    const guardar = async (valor: string, nome: string) => {
      const { data, error } = await admin.rpc("serpro_guardar_segredo", { p_valor: valor, p_nome: `serpro:${escritorio.id}:${nome}` });
      if (error) throw new DomainError(`Não foi possível gravar no cofre: ${error.message}`, 500);
      return data as string;
    };
    const { data: anterior } = await admin.from("integracoes_serpro").select("*").eq("escritorio_id", escritorio.id).maybeSingle();
    const agora = new Date().toISOString();
    const { error } = await admin.from("integracoes_serpro").upsert({
      escritorio_id: escritorio.id,
      cnpj_contratante: certificado.cnpj,
      titular_certificado: certificado.titular,
      certificado_valido_ate: certificado.validoAte.toISOString(),
      consumer_key_segredo_id: await guardar(consumerKey, "consumer_key"),
      consumer_secret_segredo_id: await guardar(consumerSecret, "consumer_secret"),
      certificado_segredo_id: await guardar(Buffer.from(pfx).toString("base64"), "certificado"),
      senha_segredo_id: await guardar(senha, "senha"),
      ativa: true,
      ultimo_teste_em: agora,
      ultimo_teste_ok: true,
      atualizado_por: u.id,
      atualizado_em: agora,
    });
    if (error) throw new DomainError(`Não foi possível salvar a integração: ${error.message}`, 500);
    // Remove do cofre os segredos da configuração anterior.
    if (anterior) {
      for (const id of [anterior.consumer_key_segredo_id, anterior.consumer_secret_segredo_id, anterior.certificado_segredo_id, anterior.senha_segredo_id]) {
        await admin.rpc("serpro_apagar_segredo", { p_id: id });
      }
    }
    await sb.from("registros_auditoria").insert({
      escritorio_id: escritorio.id, ator_id: u.id, ator_email: u.email, acao: "integracao_serpro_configurada",
      detalhe: `Certificado ${certificado.titular} (${certificado.cnpj}), válido até ${certificado.validoAte.toLocaleDateString("pt-BR")}.`,
    });

    return Response.json({ message: `Integração SERPRO ativa. Autenticação testada com o certificado de ${certificado.titular}.` }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
