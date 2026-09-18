// Visão macro do contador: painel de toda a carteira e central de chamados.
// Pensado para 100+ empresas: tudo é agregado no banco (painel_carteira) ou
// consultado em uma única requisição, nunca empresa por empresa.

import { DomainError, requireThat } from "./domain";
import { erroDoBanco } from "./repositorio";
import type { ClienteSupabase } from "./supabase/servidor";
import type { Linha } from "./traducao";

// ---------------------------------------------------------------------------
// Painel da carteira
// ---------------------------------------------------------------------------
export type Alerta = { tipo: "critico" | "atencao"; texto: string };
export type LinhaPainel = Linha & { alertas: Alerta[]; risco: 0 | 1 | 2; prazoPgdas: string };

/** PGDAS-D e DAS vencem no dia 20 do mês seguinte à competência. */
export function prazoPgdas(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const proximo = new Date(Date.UTC(ano, mes, 20));
  return proximo.toISOString().slice(0, 10);
}

const dias = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000);

/**
 * Converte os números do banco em alertas legíveis. Enquanto o SERPRO não estiver
 * conectado, o atraso da apuração é inferido pela situação do fechamento.
 */
export function classificar(l: Linha, competencia: string, hoje: string): LinhaPainel {
  const alertas: Alerta[] = [];
  const prazo = prazoPgdas(competencia);
  const faltam = dias(hoje, prazo);
  const fechado = ["revisada", "aprovada"].includes(l.competencia_situacao);

  if (!l.competencia_situacao) alertas.push({ tipo: "atencao", texto: "Competência não aberta" });
  if (l.pgdas_transmitida === false && faltam < 0) alertas.push({ tipo: "critico", texto: "PGDAS-D atrasada" });
  else if (l.pgdas_transmitida == null && !fechado && faltam < 0) alertas.push({ tipo: "critico", texto: "Apuração atrasada" });
  else if (l.pgdas_transmitida !== true && !fechado && faltam <= 5) alertas.push({ tipo: "atencao", texto: faltam === 0 ? "Apuração vence hoje" : `Apuração vence em ${faltam} dia(s)` });
  if (l.das_pago === false && l.das_vencimento && l.das_vencimento < hoje) alertas.push({ tipo: "critico", texto: "DAS vencido" });
  if (l.situacao_fiscal === "pendencias") alertas.push({ tipo: "critico", texto: "Pendências na situação fiscal" });
  // O SERPRO informa 0 (nenhuma), 1 (uma) ou 2 (várias) mensagens novas.
  if (l.caixa_postal_novas > 0) alertas.push({ tipo: "atencao", texto: l.caixa_postal_novas === 1 ? "1 mensagem nova na Caixa Postal" : "Mensagens novas na Caixa Postal" });
  if (l.chamados_aguardando_escritorio > 0) alertas.push({ tipo: "atencao", texto: `${l.chamados_aguardando_escritorio} chamado(s) aguardando o escritório` });
  if (l.lancamentos_pendentes > 0) alertas.push({ tipo: "atencao", texto: `${l.lancamentos_pendentes} lançamento(s) sem classificação` });
  if (l.outras_entradas_pendentes > 0) alertas.push({ tipo: "atencao", texto: `${l.outras_entradas_pendentes} outra(s) entrada(s) a esclarecer` });
  if (!l.matriz_confirmada) alertas.push({ tipo: "atencao", texto: "Matriz tributária não confirmada" });
  if (l.tarefas_atrasadas > 0) alertas.push({ tipo: "critico", texto: `${l.tarefas_atrasadas} tarefa(s) atrasada(s)` });
  if (l.cobrancas_vencidas > 0) alertas.push({ tipo: "atencao", texto: `${l.cobrancas_vencidas} cobrança(s) do escritório vencida(s)` });

  const risco = alertas.some((a) => a.tipo === "critico") ? 2 : alertas.length ? 1 : 0;
  return { ...l, alertas, risco, prazoPgdas: prazo };
}

export async function painelCarteira(sb: ClienteSupabase, competencia: string, hoje = new Date().toISOString().slice(0, 10)) {
  requireThat(/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia), "Competência inválida.");
  const { data, error } = await sb.rpc("painel_carteira", { p_competencia: competencia });
  if (error) throw erroDoBanco(error);
  const linhas = (data as Linha[]).map((l) => classificar(l, competencia, hoje));
  // Mais urgente primeiro; empate por nome.
  linhas.sort((a, b) => b.risco - a.risco || b.alertas.length - a.alertas.length || a.razao_social.localeCompare(b.razao_social));
  return {
    competencia,
    prazoPgdas: prazoPgdas(competencia),
    totais: {
      empresas: linhas.length,
      criticas: linhas.filter((l) => l.risco === 2).length,
      atencao: linhas.filter((l) => l.risco === 1).length,
      emDia: linhas.filter((l) => l.risco === 0).length,
      chamadosAguardando: linhas.reduce((s, l) => s + (l.chamados_aguardando_escritorio ?? 0), 0),
      fechadas: linhas.filter((l) => ["revisada", "aprovada"].includes(l.competencia_situacao)).length,
    },
    empresas: linhas,
  };
}

// ---------------------------------------------------------------------------
// Central de chamados
// ---------------------------------------------------------------------------
const PESO_PRIORIDADE: Record<string, number> = { urgente: 3, alta: 2, normal: 1, baixa: 0 };
export const SITUACOES_CHAMADO = ["recebida", "em_atendimento", "aguardando_aceite", "orcamento_aceito", "concluida"] as const;
export const PRIORIDADES = ["baixa", "normal", "alta", "urgente"] as const;

export async function listarChamados(sb: ClienteSupabase, filtros: { situacao?: string; empresaId?: string; responsavelId?: string }) {
  let consulta = sb.from("solicitacoes")
    .select("id, empresa_id, competencia, titulo, descricao, tipo, categoria, situacao, prioridade, responsavel, responsavel_id, aguardando, prazo, criado_em, ultima_interacao_em, valor_orcamento, aceito_em, empresas(razao_social)")
    .limit(500);
  if (filtros.situacao === "abertos" || !filtros.situacao) consulta = consulta.neq("situacao", "concluida");
  else if (filtros.situacao !== "todos") consulta = consulta.eq("situacao", filtros.situacao);
  if (filtros.empresaId) consulta = consulta.eq("empresa_id", filtros.empresaId);
  if (filtros.responsavelId) consulta = consulta.eq("responsavel_id", filtros.responsavelId);
  const { data, error } = await consulta;
  if (error) throw erroDoBanco(error);

  const chamados: Linha[] = (data as Linha[]).map(({ empresas, ...c }) => ({ ...c, empresa: empresas?.razao_social ?? "" }));
  // Fila: primeiro o que depende do escritório, depois prioridade, depois o mais antigo sem resposta.
  chamados.sort((a, b) =>
    Number(b.aguardando === "escritorio") - Number(a.aguardando === "escritorio")
    || (PESO_PRIORIDADE[b.prioridade] ?? 1) - (PESO_PRIORIDADE[a.prioridade] ?? 1)
    || String(a.ultima_interacao_em).localeCompare(String(b.ultima_interacao_em)));
  return chamados;
}

export async function detalharChamado(sb: ClienteSupabase, id: string) {
  const [chamado, mensagens] = await Promise.all([
    sb.from("solicitacoes").select("*, empresas(razao_social)").eq("id", id).maybeSingle(),
    sb.from("mensagens_chamado").select("id, autor_email, autor_nome, lado, corpo, criado_em").eq("solicitacao_id", id).order("criado_em"),
  ]);
  if (chamado.error) throw erroDoBanco(chamado.error);
  requireThat(chamado.data, "Chamado não encontrado.", 404);
  return { chamado: { ...chamado.data, empresa: chamado.data.empresas?.razao_social ?? "" }, mensagens: mensagens.data ?? [] };
}

type Autor = { id: string; email: string; displayName: string };

export async function enviarMensagem(sb: ClienteSupabase, autor: Autor, chamadoId: string, corpo: string, lado: "escritorio" | "cliente") {
  const texto = corpo.trim();
  requireThat(texto.length >= 1 && texto.length <= 4000, "Escreva a mensagem (até 4.000 caracteres).");
  const { data: chamado } = await sb.from("solicitacoes").select("empresa_id").eq("id", chamadoId).maybeSingle();
  requireThat(chamado, "Chamado não encontrado.", 404);
  const { error } = await sb.from("mensagens_chamado").insert({
    solicitacao_id: chamadoId, empresa_id: chamado.empresa_id, autor_id: autor.id, autor_email: autor.email,
    autor_nome: autor.displayName, lado, corpo: texto,
  });
  if (error) throw erroDoBanco(error);
}

export async function atualizarChamado(sb: ClienteSupabase, autor: Autor, chamadoId: string, dados: { situacao?: string; prioridade?: string; responsavelId?: string | null; prazo?: string | null }) {
  const { data: atual } = await sb.from("solicitacoes").select("empresa_id, situacao, valor_orcamento, aceito_em, titulo").eq("id", chamadoId).maybeSingle();
  requireThat(atual, "Chamado não encontrado.", 404);
  const alteracao: Linha = {};
  if (dados.situacao !== undefined) {
    requireThat((SITUACOES_CHAMADO as readonly string[]).includes(dados.situacao), "Situação inválida.");
    // Mesma regra do domínio: serviço extra só conclui depois do aceite do orçamento.
    requireThat(dados.situacao !== "concluida" || !atual.valor_orcamento || atual.aceito_em, "Solicite o aceite do orçamento antes de concluir a demanda extra.");
    alteracao.situacao = dados.situacao;
  }
  if (dados.prioridade !== undefined) {
    requireThat((PRIORIDADES as readonly string[]).includes(dados.prioridade), "Prioridade inválida.");
    alteracao.prioridade = dados.prioridade;
  }
  if (dados.responsavelId !== undefined) {
    alteracao.responsavel_id = dados.responsavelId || null;
    if (dados.responsavelId) {
      const { data: perfil } = await sb.from("perfis").select("nome, email").eq("id", dados.responsavelId).maybeSingle();
      requireThat(perfil, "Responsável não encontrado na equipe.", 404);
      alteracao.responsavel = perfil.nome || perfil.email;
    } else alteracao.responsavel = null;
  }
  if (dados.prazo !== undefined) {
    requireThat(!dados.prazo || /^\d{4}-\d{2}-\d{2}$/.test(dados.prazo), "Prazo inválido.");
    alteracao.prazo = dados.prazo || null;
  }
  requireThat(Object.keys(alteracao).length, "Nada para atualizar.");
  const { error } = await sb.from("solicitacoes").update(alteracao).eq("id", chamadoId);
  if (error) throw erroDoBanco(error);
  await sb.from("registros_auditoria").insert({
    empresa_id: atual.empresa_id, ator_id: autor.id, ator_email: autor.email, acao: "chamado_atualizado",
    detalhe: `${atual.titulo}: ${Object.entries(alteracao).map(([k, v]) => `${k}=${v ?? "—"}`).join(", ")}`,
  });
}

/** Abre o mesmo chamado para várias empresas de uma vez (ex.: cobrar documentos do mês). */
export async function abrirChamadosEmLote(sb: ClienteSupabase, autor: Autor, dados: { empresaIds: string[]; titulo: string; descricao: string; prioridade?: string; prazo?: string | null; competencia: string }) {
  requireThat(Array.isArray(dados.empresaIds) && dados.empresaIds.length >= 1 && dados.empresaIds.length <= 500, "Selecione de 1 a 500 empresas.");
  const titulo = String(dados.titulo ?? "").trim(), descricao = String(dados.descricao ?? "").trim();
  requireThat(titulo.length >= 3 && titulo.length <= 180, "Informe o assunto (3 a 180 caracteres).");
  requireThat(descricao.length >= 1 && descricao.length <= 2000, "Descreva o que o cliente precisa fazer.");
  const prioridade = dados.prioridade ?? "normal";
  requireThat((PRIORIDADES as readonly string[]).includes(prioridade), "Prioridade inválida.");
  requireThat(!dados.prazo || /^\d{4}-\d{2}-\d{2}$/.test(dados.prazo), "Prazo inválido.");

  const agora = new Date().toISOString();
  const chamados = dados.empresaIds.map((empresaId) => ({
    id: crypto.randomUUID(), empresa_id: empresaId, competencia: dados.competencia, titulo, descricao, tipo: "Solicitação do escritório",
    categoria: "geral", situacao: "em_atendimento", prioridade, aguardando: "cliente", prazo: dados.prazo || null,
    solicitado_por: autor.id, solicitado_por_email: autor.email, criado_em: agora, ultima_interacao_em: agora,
  }));
  const { error } = await sb.from("solicitacoes").insert(chamados);
  if (error) throw erroDoBanco(error);
  const avisos = chamados.map((c) => ({
    empresa_id: c.empresa_id, competencia: c.competencia, titulo: `Solicitação do escritório: ${titulo}`, corpo: descricao,
    publico: "cliente", canal: "portal", origem_id: c.id,
  }));
  const { error: erroAviso } = await sb.from("notificacoes").insert(avisos);
  if (erroAviso) throw new DomainError(`Chamados abertos, mas o aviso no portal falhou: ${erroAviso.message}`, 500);
  return chamados.length;
}

export async function equipeDoEscritorio(sb: ClienteSupabase, escritorioIds: string[]) {
  const { data: membros } = await sb.from("membros_escritorio").select("usuario_id, papel").in("escritorio_id", escritorioIds);
  const ids = (membros ?? []).map((m) => m.usuario_id);
  if (!ids.length) return [];
  const { data: perfis } = await sb.from("perfis").select("id, nome, email").in("id", ids);
  return (perfis ?? []).map((p) => ({ id: p.id, nome: p.nome || p.email, email: p.email }));
}
