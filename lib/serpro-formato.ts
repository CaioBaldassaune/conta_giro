// Formato das requisições do Integra Contador (código puro, testável fora do Next).

export type TipoServico = "Apoiar" | "Consultar" | "Declarar" | "Emitir" | "Monitorar";

export type Pedido = {
  tipo: TipoServico;
  idSistema: string;
  idServico: string;
  versaoSistema?: string;
  contribuinte: string; // CNPJ (14) ou CPF (11)
  dados: Record<string, unknown> | "";
};
export type Mensagem = { codigo: string; texto: string };

/** Monta o corpo exatamente como o gateway espera ("dados" como JSON escapado). */
export function montarCorpo(cnpjContratante: string, p: Pedido) {
  const ni = (numero: string) => ({ numero, tipo: numero.length === 11 ? 1 : 2 });
  return {
    contratante: ni(cnpjContratante),
    autorPedidoDados: ni(cnpjContratante),
    contribuinte: ni(p.contribuinte),
    pedidoDados: {
      idSistema: p.idSistema,
      idServico: p.idServico,
      versaoSistema: p.versaoSistema ?? "1.0",
      dados: p.dados === "" ? "" : JSON.stringify(p.dados),
    },
  };
}

/** Identificador opcional da requisição (aparece no relatório de consumo do SERPRO). */
export const etiquetaRequisicao = (cnpjContratante: string, contribuinte: string) =>
  `2${cnpjContratante}${contribuinte.length === 11 ? 1 : 2}${contribuinte.padStart(14, "0")}`.slice(0, 32);

