// Serviços do Integra Contador usados pelo painel do contador.
// Parâmetros conforme a documentação de cada serviço (Catálogo de Serviços).

import "server-only";
import { DomainError, requireThat } from "./domain";
import { chamarSerpro, type CredenciaisSerpro, type RespostaSerpro } from "./serpro";
import type { ClienteAdmin } from "./supabase/admin";

type Registro = { empresaId?: string; usuarioId?: string };
const periodoApuracao = (competencia: string) => competencia.replace("-", ""); // 2026-08 → 202608
const dataIso = (aaaammdd: unknown) => {
  const s = String(aaaammdd ?? "").replace(/\D/g, "");
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
};
const primeiro = (v: unknown) => (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | undefined;
const centavos = (v: unknown) => (typeof v === "number" ? Math.round(v * 100) : typeof v === "string" && v ? Math.round(Number(v.replace(",", ".")) * 100) : null);

/** CAIXAPOSTAL/INNOVAMSG63 (Monitorar, não cobrado): 0 = nenhuma, 1 = uma, 2 = várias mensagens novas. */
export async function indicadorCaixaPostal(admin: ClienteAdmin, cred: CredenciaisSerpro, cnpj: string, r: Registro) {
  const res = await chamarSerpro(admin, cred, { tipo: "Monitorar", idSistema: "CAIXAPOSTAL", idServico: "INNOVAMSG63", contribuinte: cnpj, dados: "" }, r);
  const dados = primeiro(res.dados);
  const indicador = Number(dados?.indicadorMensagensNovas ?? 0);
  return Number.isFinite(indicador) ? indicador : 0;
}

/** PGDASD/CONSULTIMADECREC14 (Consultar, cobrado): última declaração transmitida no período. */
export async function ultimaDeclaracaoPgdas(admin: ClienteAdmin, cred: CredenciaisSerpro, cnpj: string, competencia: string, r: Registro) {
  let res: RespostaSerpro;
  try {
    res = await chamarSerpro(admin, cred, { tipo: "Consultar", idSistema: "PGDASD", idServico: "CONSULTIMADECREC14", contribuinte: cnpj, dados: { periodoApuracao: periodoApuracao(competencia) } }, r);
  } catch (e) {
    // "Não encontrado" significa que ainda não há declaração transmitida no período.
    if (e instanceof DomainError && e.status === 404) return { transmitida: false as const, mensagem: e.message };
    throw e;
  }
  const dados = primeiro(res.dados);
  const numero = dados?.numeroDeclaracao ? String(dados.numeroDeclaracao) : null;
  return numero
    ? { transmitida: true as const, numeroDeclaracao: numero, recibo: dados?.recibo as { nomeArquivo?: string; pdf?: string } | undefined }
    : { transmitida: false as const, mensagem: res.mensagens.map((m) => m.texto).join(" ") };
}

/** PGDASD/GERARDAS12 (Emitir, cobrado): DAS do período em PDF com valores e vencimento. */
export async function gerarDas(admin: ClienteAdmin, cred: CredenciaisSerpro, cnpj: string, competencia: string, r: Registro) {
  const res = await chamarSerpro(admin, cred, { tipo: "Emitir", idSistema: "PGDASD", idServico: "GERARDAS12", contribuinte: cnpj, dados: { periodoApuracao: periodoApuracao(competencia) } }, r);
  const das = primeiro(res.dados);
  requireThat(das?.pdf, `O SERPRO não devolveu o DAS. ${res.mensagens.map((m) => m.texto).join(" ")}`, 502);
  const det = primeiro(das.detalhamento);
  const valores = (det?.valores ?? {}) as Record<string, unknown>;
  return {
    pdfBase64: String(das.pdf),
    numeroDocumento: det?.numeroDocumento ? String(det.numeroDocumento) : null,
    vencimento: dataIso(det?.dataVencimento),
    valorTotal: centavos(valores.total),
  };
}

/**
 * Atualiza a situação fiscal de uma empresa na competência: Caixa Postal (grátis)
 * e PGDAS-D (1 consulta cobrada). Grava em situacoes_fiscais, que alimenta o painel.
 */
export async function atualizarSituacao(admin: ClienteAdmin, cred: CredenciaisSerpro, empresa: { id: string; cnpj: string }, competencia: string, usuarioId: string) {
  const r = { empresaId: empresa.id, usuarioId };
  const [caixa, pgdas] = await Promise.all([
    indicadorCaixaPostal(admin, cred, empresa.cnpj, r),
    ultimaDeclaracaoPgdas(admin, cred, empresa.cnpj, competencia, r),
  ]);
  const { error } = await admin.from("situacoes_fiscais").upsert({
    empresa_id: empresa.id,
    competencia,
    caixa_postal_novas: caixa,
    pgdas_transmitida: pgdas.transmitida,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "empresa_id,competencia" });
  if (error) throw new DomainError(`Situação consultada, mas não foi possível gravar: ${error.message}`, 500);
  return { caixaPostal: caixa, pgdasTransmitida: pgdas.transmitida };
}
