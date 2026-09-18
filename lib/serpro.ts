// Cliente do SERPRO Integra Contador.
//
// Autenticação (documentação oficial, "Como autenticar na API"):
//   POST https://autenticacao.sapi.serpro.gov.br/authenticate
//   Authorization: Basic base64(consumerKey:consumerSecret) • Role-Type: TERCEIROS
//   corpo grant_type=client_credentials • conexão com o certificado e-CNPJ do contratante (mTLS)
//   → { access_token, jwt_token, expires_in }
// Chamadas: POST {gateway}/{Apoiar|Consultar|Declarar|Emitir|Monitorar}
//   Authorization: Bearer access_token • jwt_token: jwt_token
//
// O escritório é contratante e autor do pedido (sem termo de autorização);
// cada cliente precisa ter dado procuração no e-CAC ao CNPJ do escritório.

import "server-only";
import https from "node:https";
import { DomainError } from "./domain";
import { exigirValido, lerCertificado, type Certificado } from "./certificado";
import type { ClienteAdmin } from "./supabase/admin";
import { etiquetaRequisicao, montarCorpo, type Mensagem, type Pedido } from "./serpro-formato";
export type { Pedido, TipoServico } from "./serpro-formato";

const URL_AUTENTICACAO = "https://autenticacao.sapi.serpro.gov.br/authenticate";
const URL_GATEWAY = "https://gateway.apiserpro.serpro.gov.br/integra-contador/v1";
// Códigos que o SERPRO não cobra (além dos tipos Apoiar e Monitorar).
const NAO_BILHETADOS = new Set([204, 304, 400, 401, 404, 429, 500, 503]);


export type CredenciaisSerpro = {
  escritorioId: string;
  cnpjContratante: string;
  consumerKey: string;
  consumerSecret: string;
  certificado: Certificado;
};

type RespostaHttp = { status: number; corpo: string; cabecalhos: Record<string, string | string[] | undefined> };

function requisicao(url: string, opcoes: { corpo: string; cabecalhos: Record<string, string>; certificado?: Certificado }): Promise<RespostaHttp> {
  return new Promise((resolver, rejeitar) => {
    const req = https.request(url, {
      method: "POST",
      headers: { ...opcoes.cabecalhos, "Content-Length": Buffer.byteLength(opcoes.corpo) },
      key: opcoes.certificado?.chavePem,
      cert: opcoes.certificado?.certificadoPem,
      timeout: 60_000,
    }, (res) => {
      const partes: Buffer[] = [];
      res.on("data", (p) => partes.push(p));
      res.on("end", () => resolver({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString("utf8"), cabecalhos: res.headers }));
    });
    req.on("timeout", () => req.destroy(new Error("Tempo esgotado na comunicação com o SERPRO.")));
    req.on("error", rejeitar);
    req.end(opcoes.corpo);
  });
}

// ---------------------------------------------------------------------------
// Tokens (válidos por ~30 min; guardados em memória por escritório)
// ---------------------------------------------------------------------------
type Token = { accessToken: string; jwtToken: string; expiraEm: number };
const tokens = new Map<string, Token>();

export async function autenticar(cred: CredenciaisSerpro, forcar = false): Promise<Token> {
  const atual = tokens.get(cred.escritorioId);
  if (!forcar && atual && atual.expiraEm > Date.now() + 60_000) return atual;

  const basico = Buffer.from(`${cred.consumerKey}:${cred.consumerSecret}`).toString("base64");
  const res = await requisicao(URL_AUTENTICACAO, {
    corpo: "grant_type=client_credentials",
    cabecalhos: { Authorization: `Basic ${basico}`, "Role-Type": "TERCEIROS", "Content-Type": "application/x-www-form-urlencoded" },
    certificado: cred.certificado,
  });
  let dados: Record<string, unknown> = {};
  try { dados = JSON.parse(res.corpo); } catch { /* resposta não JSON */ }
  if (res.status === 495 || res.status === 496) {
    // Resposta do próprio gateway quando o certificado da conexão não é aceito.
    throw new DomainError("O SERPRO não aceitou o certificado. Use um e-CNPJ ICP-Brasil válido — o mesmo usado na contratação do Integra Contador.", 422);
  }
  if (res.status !== 200 || !dados.access_token || !dados.jwt_token) {
    throw new DomainError(
      `O SERPRO recusou a autenticação (HTTP ${res.status}). Confira Consumer Key/Secret e se o certificado é o mesmo usado na contratação.`,
      res.status === 401 || res.status === 403 ? 422 : 502,
    );
  }
  const token = {
    accessToken: String(dados.access_token),
    jwtToken: String(dados.jwt_token),
    expiraEm: Date.now() + Number(dados.expires_in ?? 1800) * 1000,
  };
  tokens.set(cred.escritorioId, token);
  return token;
}

// ---------------------------------------------------------------------------
// Credenciais guardadas no Vault
// ---------------------------------------------------------------------------
const credenciaisEmMemoria = new Map<string, { versao: string; cred: CredenciaisSerpro }>();

export async function carregarCredenciais(admin: ClienteAdmin, escritorioId: string): Promise<CredenciaisSerpro> {
  const { data: cfg } = await admin.from("integracoes_serpro").select("*").eq("escritorio_id", escritorioId).maybeSingle();
  if (!cfg || !cfg.ativa) throw new DomainError("Integração SERPRO não configurada. Acesse Contabilidade → Integrações.", 409);
  const emMemoria = credenciaisEmMemoria.get(escritorioId);
  if (emMemoria && emMemoria.versao === cfg.atualizado_em) return emMemoria.cred;

  const ler = async (id: string) => {
    const { data, error } = await admin.rpc("serpro_ler_segredo", { p_id: id });
    if (error || typeof data !== "string") throw new DomainError("Não foi possível ler as credenciais do SERPRO no cofre.", 500);
    return data;
  };
  const [consumerKey, consumerSecret, pfxBase64, senha] = await Promise.all([
    ler(cfg.consumer_key_segredo_id), ler(cfg.consumer_secret_segredo_id), ler(cfg.certificado_segredo_id), ler(cfg.senha_segredo_id),
  ]);
  const certificado = lerCertificado(Buffer.from(pfxBase64, "base64"), senha);
  exigirValido(certificado);
  const cred = { escritorioId, cnpjContratante: cfg.cnpj_contratante, consumerKey, consumerSecret, certificado };
  credenciaisEmMemoria.set(escritorioId, { versao: cfg.atualizado_em, cred });
  return cred;
}

// ---------------------------------------------------------------------------
// Chamada genérica
// ---------------------------------------------------------------------------
export type RespostaSerpro = { status: number; mensagens: Mensagem[]; dados: unknown };

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cobrado = (tipo: string) => !["Apoiar", "Monitorar"].includes(tipo);

/** Mensagem padrão quando a empresa está com procuração pendente (sem nova chamada cobrada). */
export class ProcuracaoPendente extends DomainError {
  constructor(contribuinte: string, detalhe?: string | null) {
    super(
      `Procuração pendente no e-CAC para o CNPJ ${contribuinte}: o ContaGiro bloqueou a chamada para não gerar cobrança. ` +
      `Depois que o cliente outorgar a procuração ao escritório, use "Verificar procuração" (consulta não cobrada).` +
      (detalhe ? ` Última resposta do SERPRO: ${detalhe}` : ""),
      409,
    );
  }
}

async function registrarProcuracao(admin: ClienteAdmin, empresaId: string, situacao: "pendente" | "ativa", servico: string, mensagem: string | null) {
  await admin.from("procuracoes_serpro").upsert(
    { empresa_id: empresaId, situacao, servico_negado: situacao === "pendente" ? servico : null, mensagem, verificada_em: new Date().toISOString() },
    { onConflict: "empresa_id" },
  );
}

export async function chamarSerpro(
  admin: ClienteAdmin,
  cred: CredenciaisSerpro,
  pedido: Pedido,
  registro: { empresaId?: string; usuarioId?: string; ignorarBloqueio?: boolean },
): Promise<RespostaSerpro> {
  // Empresa sem procuração: não gasta chamada cobrada (o SERPRO cobra também o 403).
  if (registro.empresaId && cobrado(pedido.tipo) && !registro.ignorarBloqueio) {
    const { data: procuracao } = await admin.from("procuracoes_serpro").select("situacao, mensagem").eq("empresa_id", registro.empresaId).maybeSingle();
    if (procuracao?.situacao === "pendente") throw new ProcuracaoPendente(pedido.contribuinte, procuracao.mensagem);
  }
  const corpo = JSON.stringify(montarCorpo(cred.cnpjContratante, pedido));
  const tag = etiquetaRequisicao(cred.cnpjContratante, pedido.contribuinte);
  let res: RespostaHttp | null = null;
  const inicio = Date.now();

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const token = await autenticar(cred, tentativa > 1 && res?.status === 401);
    res = await requisicao(`${URL_GATEWAY}/${pedido.tipo}`, {
      corpo,
      cabecalhos: { Authorization: `Bearer ${token.accessToken}`, jwt_token: token.jwtToken, "Content-Type": "application/json", "X-Request-Tag": tag },
    });
    if (res.status === 401) continue; // token expirado: autentica de novo
    if (res.status === 429 || res.status === 503) { await espera(1500 * tentativa); continue; }
    break;
  }

  let json: Record<string, unknown> = {};
  try { json = JSON.parse(res!.corpo); } catch { /* corpo vazio ou não JSON */ }
  const mensagens = ((json.mensagens as Mensagem[]) ?? []).filter(Boolean);
  let dados: unknown = json.dados ?? null;
  if (typeof dados === "string" && dados.trim()) { try { dados = JSON.parse(dados); } catch { /* texto simples */ } }

  await admin.from("requisicoes_serpro").insert({
    escritorio_id: cred.escritorioId,
    empresa_id: registro.empresaId ?? null,
    tipo: pedido.tipo,
    id_sistema: pedido.idSistema,
    id_servico: pedido.idServico,
    status_http: res!.status,
    bilhetada: cobrado(pedido.tipo) && !NAO_BILHETADOS.has(res!.status),
    mensagem: mensagens.map((m) => `${m.codigo} ${m.texto}`).join(" | ").slice(0, 1000) || null,
    x_request_tag: tag,
    duracao_ms: Date.now() - inicio,
    solicitado_por: registro.usuarioId ?? null,
  });

  if (res!.status >= 400) {
    const texto = mensagens.map((m) => m.texto).join(" ") || `HTTP ${res!.status}`;
    const semProcuracao = mensagens.some((m) => /ICGERENCIADOR-0(22|32)/.test(m.codigo)) || /procura[cç][aã]o/i.test(texto);
    if (semProcuracao && registro.empresaId) {
      await registrarProcuracao(admin, registro.empresaId, "pendente", `${pedido.idSistema}/${pedido.idServico}`, mensagens.map((m) => `${m.codigo} ${m.texto}`).join(" | ").slice(0, 1000));
    }
    throw new DomainError(
      semProcuracao ? `Sem procuração no e-CAC para este contribuinte (${pedido.contribuinte}). ${texto}` : `SERPRO: ${texto}`,
      res!.status === 404 ? 404 : res!.status === 403 ? 403 : 502,
    );
  }
  // Uma chamada cobrada bem-sucedida comprova a procuração para aquele serviço.
  if (registro.empresaId && cobrado(pedido.tipo)) await registrarProcuracao(admin, registro.empresaId, "ativa", `${pedido.idSistema}/${pedido.idServico}`, null);
  return { status: res!.status, mensagens, dados };
}

export { registrarProcuracao };
