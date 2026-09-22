import { context, fail, sameOrigin } from "@/lib/server";
import { normalize, requireThat } from "@/lib/domain";
import { diaAnterior } from "@/lib/openfinance";
import { NOME_CONTA_DEMONSTRACAO, PAPEIS_EXTRATO, idContaBancaria, nomeDaConta } from "@/lib/openfinance-servico";
import { carregarCredenciaisOf, criarConta, garantirPagador } from "@/lib/openfinance-tecnospeed";
import { clienteAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Contas da empresa conectadas (ou aguardando consentimento) no Open Finance.
export async function GET(request: Request) {
  try {
    const empresaId = new URL(request.url).searchParams.get("empresa") ?? "";
    const ctx = await context(empresaId);
    const admin = clienteAdmin();
    const [{ data: contas }, { data: protocolos }] = await Promise.all([
      admin.from("contas_bancarias").select("id, nome, openfinance_situacao, openfinance_link, openfinance_ultimo_dia").eq("empresa_id", ctx.company.id).not("openfinance_situacao", "is", null).order("nome"),
      admin.from("protocolos_extrato").select("situacao, mensagem, importados, criado_em, concluido_em").eq("empresa_id", ctx.company.id).order("criado_em", { ascending: false }).limit(5),
    ]);
    const pendentes = ctx.records.filter((r) => r.kind === "transaction" && r.data.origin === "openfinance" && !r.data.category).length;
    return Response.json({
      contas: contas ?? [], protocolos: protocolos ?? [], pendentes, ontem: diaAnterior(),
      demonstracao: !!ctx.company.data.demo, podeConectar: PAPEIS_EXTRATO.includes(ctx.role),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

// Conecta uma conta: cadastra pagador e conta na TecnoSpeed e devolve o link de consentimento.
// Empresa de demonstração: cria a conta de exemplo, sem chamar a TecnoSpeed.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const d = await request.json();
    const ctx = await context(String(d.empresaId ?? ""));
    requireThat(PAPEIS_EXTRATO.includes(ctx.role), "Seu perfil não conecta contas bancárias.", 403);
    const admin = clienteAdmin();

    if (ctx.company.data.demo && d.demonstracao) {
      const nome = NOME_CONTA_DEMONSTRACAO;
      await admin.from("contas_bancarias").upsert({ id: idContaBancaria(ctx.company.id, nome), empresa_id: ctx.company.id, nome, nome_normalizado: normalize(nome), banco: "999", openfinance_situacao: "demonstracao" });
      return Response.json({ message: "Conta de demonstração conectada. O extrato de exemplo chega a cada D+1." }, { headers: { "Cache-Control": "no-store" } });
    }

    const banco = String(d.banco ?? "").replace(/\D/g, "").padStart(3, "0");
    const agencia = String(d.agencia ?? "").replace(/\D/g, "");
    const conta = String(d.conta ?? "").replace(/\D/g, "");
    requireThat(/^\d{3}$/.test(banco) && agencia.length >= 1 && agencia.length <= 6 && conta.length >= 1 && conta.length <= 15, "Informe banco (3 dígitos), agência e conta.");
    requireThat(ctx.company.data.cnpj, "Cadastre o CNPJ da empresa.");

    const cred = await carregarCredenciaisOf(admin, ctx.escritorioId);
    const { data: e } = await admin.from("empresas").select("razao_social, email, municipio, uf, cep, logradouro, numero, bairro").eq("id", ctx.company.id).single();
    await garantirPagador(cred, {
      cnpj: ctx.company.data.cnpj, razaoSocial: e!.razao_social, email: e!.email, logradouro: e!.logradouro, numero: e!.numero, bairro: e!.bairro,
      cidade: String(e!.municipio ?? "").split("/")[0].trim() || null, uf: e!.uf, cep: e!.cep,
    });
    const criada = await criarConta(cred, ctx.company.data.cnpj, {
      bankCode: banco, agency: agencia, agencyDigit: String(d.agenciaDigito ?? "").replace(/\W/g, ""), accountNumber: conta, accountDac: String(d.contaDigito ?? "").replace(/\W/g, ""),
    });
    const nome = nomeDaConta(banco, agencia, conta);
    await admin.from("contas_bancarias").upsert({
      id: idContaBancaria(ctx.company.id, nome), empresa_id: ctx.company.id, nome, nome_normalizado: normalize(nome), banco, agencia, numero: conta,
      openfinance_account_hash: criada.accountHash, openfinance_link: criada.openfinanceLink, openfinance_situacao: "aguardando_consentimento",
    });
    return Response.json({ message: "Conta cadastrada. Abra o link de consentimento e autorize no aplicativo do banco.", link: criada.openfinanceLink }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
