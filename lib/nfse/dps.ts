// Montagem da DPS (Declaração de Prestação de Serviço) do Sistema Nacional NFS-e,
// leiaute v1.01 (esquemas XSD de 09/02/2026). Código puro: testado contra o XSD oficial
// em tests/nfse.test.mjs. A ordem dos elementos segue exatamente o XSD.
//
// Regras do Anexo I aplicadas aqui:
// - Id = "DPS" + cLocEmi(7) + tipo inscrição(1: 1=CPF, 2=CNPJ) + inscrição(14) + série(5) + nDPS(15)
// - E0008: dhEmi não pode ser posterior ao processamento → usamos "agora menos 1 minuto"
// - E0015: dCompet ≤ data de emissão
// - E0162: regApTribSN só para ME/EPP (opSimpNac = 3)
// - E0712: ME/EPP informa pTotTribSN (nunca indTotTrib)
// - pAliq: não informado quando o município de incidência está no Sistema Nacional
// - E1228: nenhum prefixo de namespace no XML

export const NAMESPACE_NFSE = "http://www.sped.fazenda.gov.br/nfse";
export const VERSAO_DPS = "1.01";

export type AmbienteNfse = "producao_restrita" | "producao";

export type DadosDps = {
  ambiente: AmbienteNfse;
  emitidaEm: Date;
  serie: string;
  numero: number;
  dataCompetencia: string; // AAAA-MM-DD
  codigoIbgeEmissao: string;
  versaoAplicativo?: string;
  prestador: {
    cnpj: string;
    inscricaoMunicipal?: string | null;
    telefone?: string | null;
    email?: string | null;
    opSimplesNacional: "1" | "2" | "3";
    regimeApuracaoSN?: "1" | "2" | "3" | null;
    regimeEspecial?: string;
  };
  tomador?: { documento: string; nome: string; email?: string | null; inscricaoMunicipal?: string | null } | null;
  servico: {
    codigoIbgePrestacao: string;
    codigoTributacaoNacional: string; // 6 dígitos
    codigoTributacaoMunicipal?: string | null;
    descricao: string;
    nbs?: string | null;
    informacoesComplementares?: string | null;
  };
  valores: {
    servicoCentavos: number;
    issRetido: boolean;
    aliquotaIssPercentual?: number | null; // só quando o município de incidência não está no Sistema Nacional
    percentualTributosSN?: number | null; // obrigatório para ME/EPP (E0712)
  };
};

export class ErroDps extends Error {}

function exigir(condicao: unknown, mensagem: string): asserts condicao {
  if (!condicao) throw new ErroDps(mensagem);
}
const digitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

export function escaparXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Texto livre: sem quebras duplicadas nem caracteres de controle, dentro do limite. */
const texto = (s: string, max: number) => escaparXml(s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/\s+/g, " ").trim().slice(0, max));

/** Valor em centavos → decimal do leiaute (TSDec15V2: "1500.00", "0.50"). */
export const valorDecimal = (centavos: number) => {
  exigir(Number.isInteger(centavos) && centavos >= 0, "Valor inválido.");
  return (centavos / 100).toFixed(2);
};

/** Percentual com 2 casas (TSDec2V2 / TSDec1V2). */
const percentual = (p: number, maxInteiros: number) => {
  const s = p.toFixed(2);
  exigir(p >= 0 && s.split(".")[0].length <= maxInteiros, `Percentual inválido: ${p}.`);
  return s;
};

/** Data/hora no fuso de Brasília (UTC-3), formato TSDateTimeUTC: AAAA-MM-DDThh:mm:ss-03:00. */
export function dataHoraBrasilia(d: Date) {
  const local = new Date(d.getTime() - 3 * 3_600_000);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

export function idDps(d: Pick<DadosDps, "codigoIbgeEmissao" | "serie" | "numero"> & { documentoPrestador: string }) {
  const doc = digitos(d.documentoPrestador);
  const tipo = doc.length === 11 ? "1" : "2";
  return `DPS${d.codigoIbgeEmissao}${tipo}${doc.padStart(14, "0")}${d.serie.padStart(5, "0")}${String(d.numero).padStart(15, "0")}`;
}

function documento(doc: string) {
  const d = digitos(doc);
  exigir(d.length === 11 || d.length === 14, `CPF/CNPJ inválido: ${doc}`);
  return d.length === 11 ? `<CPF>${d}</CPF>` : `<CNPJ>${d}</CNPJ>`;
}

/** Gera o XML da DPS sem assinatura (a assinatura entra depois de infDPS). */
export function montarDps(d: DadosDps): { xml: string; id: string } {
  const p = d.prestador, s = d.servico, v = d.valores;
  exigir(/^\d{7}$/.test(d.codigoIbgeEmissao) && /^\d{7}$/.test(s.codigoIbgePrestacao), "Código IBGE do município deve ter 7 dígitos.");
  exigir(/^\d{1,5}$/.test(d.serie), "Série da DPS deve ter de 1 a 5 dígitos.");
  exigir(Number.isInteger(d.numero) && d.numero >= 1 && String(d.numero).length <= 15, "Número da DPS inválido.");
  exigir(/^\d{4}-\d{2}-\d{2}$/.test(d.dataCompetencia), "Data de competência inválida.");
  exigir(/^\d{6}$/.test(s.codigoTributacaoNacional), "Código de tributação nacional deve ter 6 dígitos (item, subitem e desdobro).");
  exigir(!s.nbs || /^\d{9}$/.test(digitos(s.nbs)), "Código NBS deve ter 9 dígitos.");
  exigir(!s.codigoTributacaoMunicipal || /^\d{3}$/.test(digitos(s.codigoTributacaoMunicipal)), "Código de tributação municipal deve ter 3 dígitos.");
  exigir(v.servicoCentavos > 0, "O valor do serviço deve ser maior que zero.");
  exigir(p.opSimplesNacional !== "3" || p.regimeApuracaoSN, "Informe o regime de apuração do Simples Nacional (ME/EPP).");
  exigir(p.opSimplesNacional !== "3" || v.percentualTributosSN != null, "Para ME/EPP é obrigatório informar o percentual aproximado dos tributos do Simples Nacional (regra E0712).");

  const emitidaEm = new Date(d.emitidaEm.getTime() - 60_000); // E0008: margem para diferença de relógio
  const dhEmi = dataHoraBrasilia(emitidaEm);
  exigir(d.dataCompetencia <= dhEmi.slice(0, 10), "A data de competência não pode ser posterior à data de emissão (regra E0015).");
  const id = idDps({ codigoIbgeEmissao: d.codigoIbgeEmissao, serie: d.serie, numero: d.numero, documentoPrestador: p.cnpj });

  const prest = [
    documento(p.cnpj),
    p.inscricaoMunicipal ? `<IM>${texto(p.inscricaoMunicipal, 15)}</IM>` : "",
    p.telefone && digitos(p.telefone).length >= 6 ? `<fone>${digitos(p.telefone).slice(0, 20)}</fone>` : "",
    p.email ? `<email>${texto(p.email, 80)}</email>` : "",
    "<regTrib>",
    `<opSimpNac>${p.opSimplesNacional}</opSimpNac>`,
    p.opSimplesNacional === "3" ? `<regApTribSN>${p.regimeApuracaoSN}</regApTribSN>` : "",
    `<regEspTrib>${p.regimeEspecial ?? "0"}</regEspTrib>`,
    "</regTrib>",
  ].join("");

  const toma = d.tomador ? [
    "<toma>",
    documento(d.tomador.documento),
    d.tomador.inscricaoMunicipal ? `<IM>${texto(d.tomador.inscricaoMunicipal, 15)}</IM>` : "",
    `<xNome>${texto(d.tomador.nome, 300)}</xNome>`,
    d.tomador.email ? `<email>${texto(d.tomador.email, 80)}</email>` : "",
    "</toma>",
  ].join("") : "";

  const serv = [
    "<serv>",
    `<locPrest><cLocPrestacao>${s.codigoIbgePrestacao}</cLocPrestacao></locPrest>`,
    "<cServ>",
    `<cTribNac>${s.codigoTributacaoNacional}</cTribNac>`,
    s.codigoTributacaoMunicipal ? `<cTribMun>${digitos(s.codigoTributacaoMunicipal)}</cTribMun>` : "",
    `<xDescServ>${texto(s.descricao, 2000)}</xDescServ>`,
    s.nbs ? `<cNBS>${digitos(s.nbs)}</cNBS>` : "",
    "</cServ>",
    s.informacoesComplementares ? `<infoCompl><xInfComp>${texto(s.informacoesComplementares, 2000)}</xInfComp></infoCompl>` : "",
    "</serv>",
  ].join("");

  const totTrib = p.opSimplesNacional === "3"
    ? `<pTotTribSN>${percentual(v.percentualTributosSN!, 2)}</pTotTribSN>`
    : "<indTotTrib>0</indTotTrib>";
  const valores = [
    "<valores>",
    `<vServPrest><vServ>${valorDecimal(v.servicoCentavos)}</vServ></vServPrest>`,
    "<trib>",
    "<tribMun>",
    "<tribISSQN>1</tribISSQN>",
    `<tpRetISSQN>${v.issRetido ? "2" : "1"}</tpRetISSQN>`,
    v.aliquotaIssPercentual != null ? `<pAliq>${percentual(v.aliquotaIssPercentual, 1)}</pAliq>` : "",
    "</tribMun>",
    `<totTrib>${totTrib}</totTrib>`,
    "</trib>",
    "</valores>",
  ].join("");

  const infDps = [
    `<infDPS Id="${id}">`,
    `<tpAmb>${d.ambiente === "producao" ? "1" : "2"}</tpAmb>`,
    `<dhEmi>${dhEmi}</dhEmi>`,
    `<verAplic>${texto(d.versaoAplicativo ?? "ContaGiro-1.0", 20)}</verAplic>`,
    `<serie>${d.serie}</serie>`,
    `<nDPS>${d.numero}</nDPS>`,
    `<dCompet>${d.dataCompetencia}</dCompet>`,
    "<tpEmit>1</tpEmit>",
    `<cLocEmi>${d.codigoIbgeEmissao}</cLocEmi>`,
    `<prest>${prest}</prest>`,
    toma,
    serv,
    valores,
    "</infDPS>",
  ].join("");

  return { xml: `<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="${NAMESPACE_NFSE}" versao="${VERSAO_DPS}">${infDps}</DPS>`, id };
}
