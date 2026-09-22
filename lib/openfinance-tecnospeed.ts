// Cliente da API de Pagamentos / Extratos Open Finance da TecnoSpeed.
// Especificação: docs/openfinance/tecnospeed/api.json (Swagger 2.0 baixado de docs.pagamentobancario.com.br).
//
// Autenticação em todas as rotas por cabeçalhos:
//   cnpjsh / tokensh  → Software House (o escritório, contrato com a TecnoSpeed; token no Vault)
//   payercpfcnpj      → Pagador (a empresa cliente dona da conta)
// Fluxo: POST /payer (statementActived) → POST /account (statementActived) → o cliente abre o
// openfinanceLink e autoriza no banco → POST /statement/openfinance gera o protocolo (uniqueId,
// 1 por conta a cada 6 h) → GET /statement/openfinance/{uniqueId} devolve as movimentações (3/min).

import "server-only";
import { DomainError, requireThat } from "./domain";
import type { ClienteAdmin } from "./supabase/admin";
import type { ExtratoTs } from "./openfinance";

const BASES = { staging: "https://staging.pagamentobancario.com.br/api/v1", producao: "https://api.pagamentobancario.com.br/api/v1" } as const;
export type CredenciaisOf = { escritorioId: string; ambiente: keyof typeof BASES; cnpjSh: string; tokenSh: string };

/** Lê as credenciais do escritório (token no Vault). */
export async function carregarCredenciaisOf(admin: ClienteAdmin, escritorioId: string): Promise<CredenciaisOf> {
  const { data } = await admin.from("integracoes_openfinance").select("ambiente, cnpj_sh, token_segredo_id, ativa").eq("escritorio_id", escritorioId).maybeSingle();
  requireThat(data?.ativa && data.token_segredo_id, "Configure a integração Open Finance (TecnoSpeed) em Integrações.", 409);
  const { data: token, error } = await admin.rpc("cofre_ler", { p_id: data.token_segredo_id });
  if (error || typeof token !== "string") throw new DomainError("Não foi possível ler o token da TecnoSpeed no cofre.", 500);
  return { escritorioId, ambiente: data.ambiente, cnpjSh: data.cnpj_sh, tokenSh: token };
}

async function chamar<T>(cred: CredenciaisOf, metodo: "GET" | "POST" | "PUT", caminho: string, opcoes: { pagador?: string; corpo?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASES[cred.ambiente]}${caminho}`, {
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      cnpjsh: cred.cnpjSh,
      tokensh: cred.tokenSh,
      ...(opcoes.pagador ? { payercpfcnpj: opcoes.pagador } : {}),
    },
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const texto = await res.text();
  let json: Record<string, unknown> = {};
  try { json = texto ? JSON.parse(texto) : {}; } catch { /* resposta não JSON */ }
  if (!res.ok) {
    const detalhes = Array.isArray(json.errors) ? (json.errors as { message?: string }[]).map((e) => e.message).filter(Boolean).join("; ") : "";
    const mensagem = String(json.message ?? json.error ?? texto.slice(0, 200) ?? `HTTP ${res.status}`);
    throw new DomainError(`TecnoSpeed (${res.status}): ${mensagem}${detalhes ? ` — ${detalhes}` : ""}`, res.status === 401 || res.status === 403 ? 409 : res.status === 404 ? 404 : 502);
  }
  return json as T;
}

export type EmpresaPagador = { cnpj: string; razaoSocial: string; email?: string | null; logradouro?: string | null; numero?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null; cep?: string | null };

/** Cadastra o pagador com o Extrato Open Finance ativo; se já existir, apenas ativa o recurso. */
export async function garantirPagador(cred: CredenciaisOf, e: EmpresaPagador) {
  try {
    await chamar(cred, "POST", "/payer", { corpo: {
      name: e.razaoSocial, cpfCnpj: e.cnpj, email: e.email ?? undefined, street: e.logradouro ?? undefined, addressNumber: e.numero ?? "S/N",
      neighborhood: e.bairro ?? undefined, city: e.cidade ?? undefined, state: e.uf ?? undefined, zipcode: e.cep ?? undefined, statementActived: true,
    } });
  } catch (erro) {
    // Pagador já cadastrado: ativa o extrato nele (PUT /payer).
    if (!(erro instanceof DomainError) || !/exist|cadastrad|already/i.test(erro.message)) throw erro;
    await chamar(cred, "PUT", "/payer", { pagador: e.cnpj, corpo: { statementActived: true } });
  }
}

export type DadosConta = { bankCode: string; agency: string; agencyDigit?: string; accountNumber: string; accountDac?: string };

/** Cadastra a conta com o extrato ativo e devolve o link de consentimento do Open Finance. */
export async function criarConta(cred: CredenciaisOf, cnpj: string, c: DadosConta) {
  const r = await chamar<{ accounts?: { accountHash: string; openfinanceLink?: string }[] }>(cred, "POST", "/account", { pagador: cnpj, corpo: [{
    bankCode: c.bankCode, agency: c.agency, agencyDigit: c.agencyDigit ?? "", accountNumber: c.accountNumber, accountDac: c.accountDac ?? "",
    convenioAgency: "", convenioNumber: "", remessaSequential: 0, accountType: "", accountPayment: false, webservice: false, recipientNotification: false,
    statementActived: true,
  }] });
  const conta = r.accounts?.[0];
  requireThat(conta?.accountHash, "A TecnoSpeed não devolveu o identificador da conta.", 502);
  return { accountHash: conta.accountHash, openfinanceLink: conta.openfinanceLink ?? null };
}

/** Consulta a conta: openfinanceId aparece depois que o cliente autoriza no banco. */
export async function consultarConta(cred: CredenciaisOf, cnpj: string, accountHash: string) {
  const r = await chamar<{ accounts?: { openfinanceId?: string; openfinanceLink?: string } | { openfinanceId?: string; openfinanceLink?: string }[] }>(cred, "GET", `/account/${encodeURIComponent(accountHash)}`, { pagador: cnpj });
  const conta = Array.isArray(r.accounts) ? r.accounts[0] : r.accounts;
  return { openfinanceId: conta?.openfinanceId ?? null, openfinanceLink: conta?.openfinanceLink ?? null };
}

/** Gera o protocolo de extrato do período (processamento assíncrono na TecnoSpeed). */
export async function gerarProtocolo(cred: CredenciaisOf, cnpj: string, accountHash: string, dataInicio: string, dataFim: string) {
  const r = await chamar<{ uniqueId?: string; uniqueid?: string }>(cred, "POST", "/statement/openfinance", { pagador: cnpj, corpo: { accountHash, dateStart: dataInicio, dateEnd: dataFim, statementType: "BANK" } });
  const id = r.uniqueId ?? r.uniqueid;
  requireThat(id, "A TecnoSpeed não devolveu o protocolo do extrato.", 502);
  return id;
}

export async function consultarProtocolo(cred: CredenciaisOf, cnpj: string, uniqueId: string) {
  return chamar<ExtratoTs>(cred, "GET", `/statement/openfinance/${encodeURIComponent(uniqueId)}`, { pagador: cnpj });
}
