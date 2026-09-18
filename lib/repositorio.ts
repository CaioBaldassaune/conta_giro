// Acesso ao Supabase: carrega empresas no formato das regras e grava alterações
// de forma atômica via public.aplicar_alteracoes. Sempre com a sessão do usuário,
// portanto sujeito ao RLS.

import type { ClienteSupabase } from "./supabase/servidor";
import { DomainError, type Company, type Entry } from "./domain";
import { idBanco, linhasAlteradas, montarEmpresa, type ContextoTraducao, type Linha, type TabelasEmpresa } from "./traducao";

const PAGINA = 1000;

// Tabelas carregadas por empresa, com os relacionamentos embutidos necessários.
const CONSULTAS: Record<string, string> = {
  competencias: "*",
  historico_receitas: "*",
  versoes_matriz_tributaria: "*, atividades_empresa(*)",
  documentos: "*, ciencias_documento(*)",
  eventos_documento: "*",
  solicitacoes: "*",
  contatos: "*",
  notas_fiscais: "*",
  contas_bancarias: "*",
  movimentacoes_bancarias: "*",
  regras_classificacao: "*",
  contas_pagar: "*",
  notificacoes: "*, leituras_notificacao(*)",
  tarefas: "*",
  leads_comerciais: "*",
  assinaturas: "*",
  cobrancas: "*",
  colaboradores: "*",
  folhas_pagamento: "*",
  configuracoes_contabeis: "*, plano_contas(*), mapeamentos_categoria_conta(*)",
  lancamentos_contabeis: "*",
  fechamentos_contabeis: "*",
  convites: "*",
};

async function buscarTodas(sb: ClienteSupabase, tabela: string, colunas: string, empresas: string[]): Promise<Linha[]> {
  const linhas: Linha[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await sb.from(tabela).select(colunas).in("empresa_id", empresas)
      .order("id").range(inicio, inicio + PAGINA - 1);
    if (error) throw new DomainError(`Falha ao carregar ${tabela}: ${error.message}`, 500);
    linhas.push(...(data as unknown as Linha[]));
    if (!data || data.length < PAGINA) return linhas;
  }
}

export type EmpresaCarregada = {
  company: Company;
  records: Entry[];
  escritorioId: string;
  /** Linhas de atividades por versão, para resolver o id da atividade de uma nota. */
  atividades: Map<string, string>;
};

/** Carrega várias empresas com uma consulta por tabela (independe do número de empresas). */
export async function carregarEmpresas(sb: ClienteSupabase, ids: string[]): Promise<Map<string, EmpresaCarregada>> {
  const resultado = new Map<string, EmpresaCarregada>();
  if (!ids.length) return resultado;

  const { data: empresas, error } = await sb.from("empresas").select("*").in("id", ids);
  if (error) throw new DomainError(`Falha ao carregar empresas: ${error.message}`, 500);

  const nomes = Object.keys(CONSULTAS);
  // Tabelas sem permissão para o papel voltam vazias pelo RLS; não é erro.
  const conteudos = await Promise.all(nomes.map((t) => buscarTodas(sb, t, CONSULTAS[t], ids)));

  for (const empresa of empresas ?? []) {
    const tabelas: TabelasEmpresa = { empresa };
    nomes.forEach((nome, i) => {
      (tabelas as Linha)[nome] = conteudos[i].filter((l) => l.empresa_id === empresa.id);
    });
    const atividades = new Map<string, string>();
    for (const v of tabelas.versoes_matriz_tributaria ?? []) {
      for (const a of v.atividades_empresa ?? []) atividades.set(`${v.versao}:${a.referencia}`, a.id);
    }
    resultado.set(empresa.id, { ...montarEmpresa(tabelas), escritorioId: empresa.escritorio_id, atividades });
  }
  return resultado;
}

export type AlteracaoEmpresa = {
  upserts: Entry[];
  event: string;
  detail: string;
};

/**
 * Grava as alterações de uma ação numa única transação. A versão esperada é a
 * carregada no servidor; se outra pessoa gravou antes, lança DomainError 409
 * com `conflito = true` para o chamador recalcular e tentar de novo.
 */
export async function gravarAlteracoes(
  sb: ClienteSupabase,
  empresa: EmpresaCarregada,
  usuarioId: string,
  alteracao: AlteracaoEmpresa,
): Promise<number> {
  const ctx: ContextoTraducao = {
    empresaId: empresa.company.id,
    escritorioId: empresa.escritorioId,
    usuarioId,
    idAtividade: (versao, referencia) => empresa.atividades.get(`${versao}:${idBanco(referencia)}`) ?? null,
  };
  const antes = new Map(empresa.records.map((r) => [r.id, r]));
  const linhas = linhasAlteradas(alteracao.upserts, antes, ctx);

  const { data, error } = await sb.rpc("aplicar_alteracoes", {
    p_empresa: empresa.company.id,
    p_versao: empresa.company.version,
    p_linhas: linhas,
    p_acao: alteracao.event,
    p_detalhe: alteracao.detail,
  });
  if (error) throw erroDoBanco(error);
  return data as number;
}

export class ConflitoDeVersao extends DomainError {
  constructor() {
    super("Outra pessoa alterou os dados desta empresa. Atualize e tente novamente.", 409);
  }
}

export function erroDoBanco(error: { code?: string; message: string }): DomainError {
  if (error.code === "40001" || error.message.includes("CONFLITO_VERSAO")) return new ConflitoDeVersao();
  if (error.code === "42501") return new DomainError("Seu perfil não permite esta operação nesta empresa.", 403);
  if (error.code === "23505") return new DomainError("Este registro já existe (duplicidade).", 409);
  if (error.code === "23514" || error.code === "23502") return new DomainError(`Dados inválidos para gravação: ${error.message}`, 422);
  return new DomainError(`Não foi possível gravar: ${error.message}`, 500);
}
