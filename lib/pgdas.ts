// Declaração mensal do Simples Nacional (PGDAS-D) pelo Integra Contador: PGDASD/TRANSDECLARACAO11.
// Código puro (sem rede), testável fora do Next. Valores internos em centavos; o SERPRO recebe reais.
//
// Regras do serviço aplicadas aqui:
// - indicadorTransmissao=false devolve os valores devidos SEM transmitir (prévia).
// - Transmissão com receita exige indicadorComparacao=true e valoresParaComparacao iguais ao
//   cálculo do SERPRO (diferença de R$ 0,01 impede a transmissão: MSG_ISN_035).
// - Sem faturamento: receita zero e estabelecimento sem a lista "atividades"; nada devido, sem guia.

import { requireThat, type Activity } from "./domain";

/** Atividades do PGDAS-D que o ContaGiro sabe preencher (serviços, ISS no próprio município). */
export const ATIVIDADES_SN: Record<number, string> = {
  11: "Serviços sujeitos ao Fator R — ISS devido ao próprio município",
  12: "Serviços sujeitos ao Fator R — com retenção/substituição de ISS",
  14: "Serviços do Anexo III (sem Fator R) — ISS devido ao próprio município",
  15: "Serviços do Anexo III (sem Fator R) — com retenção/substituição de ISS",
  17: "Serviços do Anexo IV — ISS devido ao próprio município",
  18: "Serviços do Anexo IV — com retenção/substituição de ISS",
};

export const TRIBUTOS_SN: Record<number, string> = {
  1001: "IRPJ", 1002: "CSLL", 1004: "COFINS", 1005: "PIS/Pasep", 1006: "CPP (INSS)", 1007: "ICMS", 1008: "IPI", 1010: "ISS",
};

/** Atividade do PGDAS-D a partir da regra de anexo da matriz e da retenção de ISS na nota. */
export function atividadeSimples(anexo: Activity["annex"], issRetido: boolean): number {
  if (anexo === "IV") return issRetido ? 18 : 17;
  if (anexo === "III") return issRetido ? 15 : 14;
  return issRetido ? 12 : 11; // Anexo V e Fator R: no PGDAS-D são "sujeitos ao fator r"
}

export type ReceitaSn = { idAtividade: number; valor: number }; // valor em centavos
export type NotaResumo = { valor: number; anexo: Activity["annex"]; issRetido: boolean; outroMunicipio: boolean; numero?: string };

/** Agrupa as notas da competência por atividade do PGDAS-D (proposta que o contador confere). */
export function proporReceitas(notas: NotaResumo[]): { receitas: ReceitaSn[]; avisos: string[] } {
  const avisos: string[] = [];
  const porAtividade = new Map<number, number>();
  for (const n of notas) {
    if (n.outroMunicipio) {
      avisos.push(`Nota ${n.numero ?? "sem número"}: prestação em outro município. Confira a atividade (ISS devido a outro município não é preenchido pelo ContaGiro).`);
    }
    const id = atividadeSimples(n.anexo, n.issRetido);
    porAtividade.set(id, (porAtividade.get(id) ?? 0) + n.valor);
  }
  const receitas = [...porAtividade].map(([idAtividade, valor]) => ({ idAtividade, valor })).sort((a, b) => a.idAtividade - b.idAtividade);
  return { receitas, avisos };
}

const reais = (centavos: number) => Math.round(centavos) / 100;
export const periodoPa = (competencia: string) => Number(competencia.replace("-", ""));

export function mesesAnteriores(competencia: string, n = 12): string[] {
  const [ano, mes] = competencia.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(ano, mes - 1 - n + i, 15));
    return d.toISOString().slice(0, 7);
  });
}

export type ValorDevido = { codigoTributo: number; valor: number }; // valor em reais, como o SERPRO devolve

export type EntradaDeclaracao = {
  cnpj: string;
  competencia: string;
  tipo: 1 | 2; // 1 = original, 2 = retificadora
  receitas: ReceitaSn[];
  folhas?: { competencia: string; valor: number }[]; // centavos; necessárias para o Fator R
  transmitir: boolean;
  valoresParaComparacao?: ValorDevido[];
};

/** Monta o objeto "dados" do TRANSDECLARACAO11. */
export function montarDeclaracao(e: EntradaDeclaracao) {
  requireThat(/^\d{14}$/.test(e.cnpj), "CNPJ inválido para a declaração.");
  requireThat(/^\d{4}-(0[1-9]|1[0-2])$/.test(e.competencia), "Competência inválida.");
  requireThat(e.tipo === 1 || e.tipo === 2, "Tipo de declaração inválido.");
  const ids = new Set<number>();
  for (const r of e.receitas) {
    requireThat(ATIVIDADES_SN[r.idAtividade], `Atividade ${r.idAtividade} do PGDAS-D não suportada pelo ContaGiro.`);
    requireThat(Number.isInteger(r.valor) && r.valor > 0, "Cada receita informada deve ser maior que zero.");
    requireThat(!ids.has(r.idAtividade), "Informe cada atividade uma única vez.");
    ids.add(r.idAtividade);
  }
  const total = e.receitas.reduce((s, r) => s + r.valor, 0);
  const comparar = e.transmitir && total > 0;
  requireThat(!comparar || e.valoresParaComparacao?.length, "Calcule a prévia antes de transmitir: a transmissão confere os valores com o cálculo do SERPRO.");

  const atividades = e.receitas.map((r) => ({ idAtividade: r.idAtividade, valorAtividade: reais(r.valor), receitasAtividade: [{ valor: reais(r.valor) }] }));
  const fatorR = e.receitas.some((r) => r.idAtividade === 11 || r.idAtividade === 12);
  return {
    cnpjCompleto: e.cnpj,
    pa: periodoPa(e.competencia),
    indicadorTransmissao: e.transmitir,
    indicadorComparacao: comparar,
    declaracao: {
      tipoDeclaracao: e.tipo,
      receitaPaCompetenciaInterno: reais(total),
      receitaPaCompetenciaExterno: 0,
      ...(fatorR && e.folhas?.length ? { folhasSalario: e.folhas.map((f) => ({ pa: periodoPa(f.competencia), valor: reais(f.valor) })) } : {}),
      // Sem faturamento: o estabelecimento vai sem a lista de atividades.
      estabelecimentos: [{ cnpjCompleto: e.cnpj, ...(atividades.length ? { atividades } : {}) }],
    },
    ...(comparar ? { valoresParaComparacao: e.valoresParaComparacao } : {}),
  };
}

export type ResultadoDeclaracao = {
  idDeclaracao: string | null;
  transmitidaEm: string | null; // ISO
  valoresDevidos: ValorDevido[];
  totalDevido: number; // centavos
  pdfDeclaracao: string | null;
  pdfRecibo: string | null;
  pdfMaed: string | null;
  pdfDarf: string | null;
};

/** Lê o "dados" do retorno (objeto ou lista com um objeto). */
export function lerResultado(dados: unknown): ResultadoDeclaracao {
  const d = (Array.isArray(dados) ? dados[0] : dados) as Record<string, unknown> | null;
  const valores = (Array.isArray(d?.valoresDevidos) ? d!.valoresDevidos : []) as ValorDevido[];
  const valoresDevidos = valores.map((v) => ({ codigoTributo: Number(v.codigoTributo), valor: Number(v.valor) }));
  const quando = String(d?.dataHoraTransmissao ?? "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  const texto = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    idDeclaracao: texto(d?.idDeclaracao),
    transmitidaEm: quando ? `${quando[1]}-${quando[2]}-${quando[3]}T${quando[4]}:${quando[5]}:${quando[6]}-03:00` : null,
    valoresDevidos,
    totalDevido: Math.round(valoresDevidos.reduce((s, v) => s + v.valor, 0) * 100),
    pdfDeclaracao: texto(d?.declaracao),
    pdfRecibo: texto(d?.recibo),
    pdfMaed: texto(d?.notificacaoMaed),
    pdfDarf: texto(d?.darf),
  };
}
