// Entrada de novos clientes pela página inicial: planos, etapas e dados da empresa pelo CNPJ.
// Código puro (sem rede), testável.
//
// Etapas (pedido do escritório):
//   1. Quem é o cliente?           → conta de acesso + empresa (CNPJ consultado na BrasilAPI)
//   2. Qual plano?                 → Essencial, Gestão ou Estratégia
//   3. Pagamento e contrato        → EM ESPERA: por ora só o aceite dos termos de uso
//   4. Procurações (cliente)       → procuração no e-CAC para o CNPJ do escritório
//   5. Grade tributária (contador) → o escritório confirma a matriz; o cliente já usa o app
// Ao concluir a etapa 4 o cliente entra direto no aplicativo.

export type Plano = "essencial" | "gestao" | "estrategia";

/** Planos exibidos na página inicial. Preços e itens são provisórios: ajuste aqui. */
export const PLANOS: Record<Plano, { nome: string; resumo: string; preco: string; itens: string[] }> = {
  essencial: {
    nome: "Essencial",
    resumo: "Contabilidade e impostos em dia, sem papelada.",
    preco: "Sob consulta",
    itens: [
      "Contabilidade mensal e obrigações acessórias",
      "Apuração do Simples Nacional (PGDAS-D e DAS)",
      "Emissão de NFS-e pelo aplicativo",
      "Extrato bancário automático (Open Finance) para categorizar",
      "Documentos e chamados com o contador no portal",
    ],
  },
  gestao: {
    nome: "Gestão",
    resumo: "Tudo do Essencial e o controle financeiro da empresa.",
    preco: "Sob consulta",
    itens: [
      "Tudo do plano Essencial",
      "DRE gerencial mensal",
      "Agenda financeira: contas a pagar e a receber",
      "Folha e pró-labore",
      "Reunião trimestral de resultados",
    ],
  },
  estrategia: {
    nome: "Estratégia",
    resumo: "Tudo do Gestão e planejamento para crescer pagando o imposto certo.",
    preco: "Sob consulta",
    itens: [
      "Tudo do plano Gestão",
      "Planejamento tributário anual (regime, Fator R, anexos)",
      "Indicadores e metas do negócio",
      "Reunião mensal com o contador",
      "BPO financeiro (em breve)",
    ],
  },
};

export const ETAPAS = [
  { numero: 1, titulo: "Quem é você?", descricao: "Crie seu acesso e informe o CNPJ da empresa." },
  { numero: 2, titulo: "Seu plano", descricao: "Essencial, Gestão ou Estratégia." },
  { numero: 3, titulo: "Pagamento e contrato", descricao: "Em breve: pagamento e assinatura digital." },
  { numero: 4, titulo: "Procurações", descricao: "Autorize o escritório no e-CAC da Receita." },
  { numero: 5, titulo: "Grade tributária", descricao: "O contador configura seus impostos." },
] as const;

/** Serviços do Integra Contador que a procuração no e-CAC precisa incluir. */
export const SERVICOS_PROCURACAO = [
  { codigo: "00146", nome: "PGDAS-D (Simples Nacional)" },
  { codigo: "00006", nome: "Caixa Postal" },
  { codigo: "00002", nome: "Situação fiscal" },
  { codigo: "00004", nome: "Pagamentos" },
];

/** CNPJ com dígitos verificadores válidos (evita cadastro com número digitado errado). */
export function cnpjValido(valor: string): boolean {
  const c = valor.replace(/\D/g, "");
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const digito = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const resto = [...base].reduce((s, n, i) => s + Number(n) * pesos[i], 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(c.slice(0, 12)) === Number(c[12]) && digito(c.slice(0, 13)) === Number(c[13]);
}

export type DadosEmpresa = {
  cnpj: string; razaoSocial: string; nomeFantasia: string | null; cep: string | null; logradouro: string | null; numero: string | null;
  complemento: string | null; bairro: string | null; municipio: string; uf: string; codigoIbge: string | null; email: string | null; telefone: string | null;
  cnaePrincipal: string | null; cnaeDescricao: string | null; simples: boolean | null; situacao: string | null;
};

const texto = (v: unknown, max: number) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s ? s.slice(0, max) : null; };
const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, espaco, letra) => espaco + letra.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E)\b/g, (p) => p.toLowerCase());

/** Converte a resposta da BrasilAPI (/api/cnpj/v1/{cnpj}) para o cadastro da empresa. */
export function dadosDaBrasilApi(j: Record<string, unknown>): DadosEmpresa {
  const cidade = texto(j.municipio, 80);
  const uf = texto(j.uf, 2)?.toUpperCase() ?? "";
  const ddd = String(j.ddd_telefone_1 ?? "").replace(/\D/g, "");
  return {
    cnpj: String(j.cnpj ?? "").replace(/\D/g, ""),
    razaoSocial: texto(j.razao_social, 180) ?? "",
    nomeFantasia: texto(j.nome_fantasia, 180),
    cep: String(j.cep ?? "").replace(/\D/g, "").length === 8 ? String(j.cep).replace(/\D/g, "") : null,
    // A BrasilAPI às vezes já traz o tipo dentro do logradouro ("QUADRA ACSO 11"): não repete.
    logradouro: texto(String(j.logradouro ?? "").toUpperCase().startsWith(String(j.descricao_tipo_de_logradouro ?? "").toUpperCase())
      ? j.logradouro : [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(" "), 125),
    numero: texto(j.numero, 10),
    complemento: texto(j.complemento, 60),
    bairro: texto(j.bairro, 60),
    municipio: cidade ? `${titulo(cidade)} / ${uf}` : "",
    uf,
    codigoIbge: /^\d{7}$/.test(String(j.codigo_municipio_ibge ?? "")) ? String(j.codigo_municipio_ibge) : null,
    email: texto(j.email, 180)?.toLowerCase() ?? null,
    telefone: ddd.length >= 10 ? `(${ddd.slice(0, 2)}) ${ddd.slice(2)}` : null,
    cnaePrincipal: j.cnae_fiscal ? String(j.cnae_fiscal).padStart(7, "0") : null,
    cnaeDescricao: texto(j.cnae_fiscal_descricao, 200),
    simples: typeof j.opcao_pelo_simples === "boolean" ? j.opcao_pelo_simples : null,
    situacao: texto(j.descricao_situacao_cadastral, 40),
  };
}
