// Camada de tradução entre o formato usado pelas regras e pela interface
// (Entry: { id, kind, period, data }) e as tabelas normalizadas do Supabase.
//
// É código puro (sem rede): o carregamento e a gravação ficam em lib/repositorio.ts.
// Isso permite manter lib/domain.ts, lib/contagiro.ts e lib/reporting.ts intactos
// enquanto o banco já é relacional, com RLS por empresa e papel.

import { createHash } from "node:crypto";
import { normalize, type Activity, type Company, type Entry } from "./domain";

// Linhas vêm do PostgREST sem tipagem gerada; o formato é validado pelo banco.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Linha = Record<string, any>;
export type LinhaTabela = { tabela: Tabela; linha: Linha };
export type ContextoTraducao = {
  empresaId: string;
  escritorioId: string;
  usuarioId: string;
  /** Resolve o id da linha em atividades_empresa para (versão da matriz, referência da atividade). */
  idAtividade?: (versao: number, referencia: string) => string | null;
};

// Ordem de gravação respeitando as chaves estrangeiras.
export const ORDEM_TABELAS = [
  "contas_bancarias", "solicitacoes", "versoes_matriz_tributaria", "atividades_empresa", "documentos",
  "eventos_documento", "ciencias_documento", "historico_receitas", "competencias", "contatos",
  "notas_fiscais", "movimentacoes_bancarias", "regras_classificacao", "contas_pagar", "notificacoes",
  "leituras_notificacao", "tarefas", "leads_comerciais", "assinaturas", "cobrancas", "colaboradores",
  "folhas_pagamento", "configuracoes_contabeis", "plano_contas", "mapeamentos_categoria_conta",
  "lancamentos_contabeis", "fechamentos_contabeis",
] as const;
export type Tabela = (typeof ORDEM_TABELAS)[number];

const CHAVES: Partial<Record<Tabela, string[]>> = {
  ciencias_documento: ["documento_id", "usuario_id"],
  leituras_notificacao: ["notificacao_id", "usuario_id"],
  mapeamentos_categoria_conta: ["configuracao_id", "categoria"],
};

// ---------------------------------------------------------------------------
// Identificadores
// ---------------------------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Converte ids legados (ex.: "empresa:tx1", "tx-<hash>") em UUID determinístico. */
export function idBanco(id: string): string {
  if (UUID.test(id)) return id.toLowerCase();
  const h = createHash("sha1").update(`contagiro:${id}`).digest("hex");
  const variante = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variante}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}
const idOpcional = (id: unknown) => (typeof id === "string" && id ? idBanco(id) : null);

// A revisão de "outras entradas" usa o id `${movimentacao}:other-review` nas regras.
const SUFIXO_REVISAO = ":other-review";
const ORIGEM_REVISAO = "revisao_outras_entradas";

// ---------------------------------------------------------------------------
// Dicionários de valores (regras em inglês ↔ banco em português)
// ---------------------------------------------------------------------------
function dicionario(pares: Record<string, string>) {
  const inverso = Object.fromEntries(Object.entries(pares).map(([a, b]) => [b, a]));
  return {
    banco: (v: unknown) => (v == null ? null : pares[String(v)] ?? String(v)),
    regra: (v: unknown) => (v == null ? null : inverso[String(v)] ?? String(v)),
  };
}

export const PAPEIS = dicionario({ accountant: "equipe", owner: "socio", finance: "financeiro", issuer: "emissor", viewer: "consulta" });
const CATEGORIAS = dicionario({
  revenue: "receita_servicos", other_revenue: "outras_entradas", rent: "aluguel", software: "software",
  telecom: "telecom", taxes: "tributos", people: "pessoal", bank: "tarifas_bancarias",
  other_expense: "outras_despesas", service_cost: "custo_servicos", transfer: "transferencia",
  loan: "emprestimo_aporte", adjustment: "estorno_ajuste",
});
const SITUACAO_COMPETENCIA = dicionario({ open: "aberta", submitted: "enviada", reviewed: "revisada", approved: "aprovada" });
const SITUACAO_NOTA = dicionario({ draft: "rascunho", simulated: "simulada", authorized: "autorizada", canceled: "cancelada" });
const SITUACAO_ISS = dicionario({ not_indicated: "nao_indicado", pending_review: "pendente_revisao", reviewed: "revisado" });
const SITUACAO_PAGAMENTO = dicionario({ pending: "pendente", paid_reported: "pagamento_informado", paid_confirmed: "pagamento_confirmado" });
const SITUACAO_SOLICITACAO = dicionario({ new: "recebida", in_progress: "em_atendimento", quoted: "aguardando_aceite", accepted: "orcamento_aceito", done: "concluida" });
const CATEGORIA_SOLICITACAO = dicionario({ tax_change: "alteracao_tributaria", payroll: "folha" });
const ORIGEM_COBRANCA = dicionario({ one_off: "avulsa", subscription: "assinatura", extra: "servico_extra" });
const CATEGORIA_DOCUMENTO = dicionario({
  monthly: "mensal", bank: "extrato_bancario", invoice: "nota_fiscal", tax: "tributos", other: "outros",
  corporate: "societario", people: "pessoal", payroll: "folha", notification: "notificacao",
});
const EVENTO_DOCUMENTO = dicionario({
  uploaded: "enviado", generated: "gerado", view_requested: "abertura_solicitada",
  download_requested: "download_solicitado", acknowledged: "ciencia", archived: "arquivado",
  restored: "restaurado", external_delivery_reported: "entrega_externa_informada",
});
const TIPO_CONTATO = dicionario({ supplier: "fornecedor", customer: "tomador", both: "ambos" });
const SITUACAO_TAREFA = dicionario({ pending: "pendente", in_progress: "em_andamento", done: "concluida" });
const SITUACAO_LEAD = dicionario({ incomplete: "incompleto", contacted: "contatado", converted: "convertido", lost: "perdido" });
const TIPO_COLABORADOR = dicionario({ employee: "empregado", prolabore: "pro_labore" });
const NATUREZA_OUTRAS = dicionario({ service: "servico", operating: "operacional", financial: "financeira", non_revenue: "nao_receita" });
const GRUPO_CONTA = dicionario({ asset: "ativo", liability: "passivo", equity: "patrimonio_liquido", revenue: "receita", expense: "despesa" });

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const ou = <T,>(v: T | undefined, padrao: T | null = null) => (v === undefined ? padrao : v);
const instante = (v: unknown) => (typeof v === "string" && v ? new Date(v).toISOString() : v ?? null);
const mes = (v: unknown) => (typeof v === "string" && v.length >= 7 ? v.slice(0, 7) : "2026-08");

/** Ordena chaves como o jsonb do Postgres (tamanho, depois bytes), recursivamente. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ordenarComoJsonb(valor: unknown): any {
  if (Array.isArray(valor)) return valor.map(ordenarComoJsonb);
  if (!valor || typeof valor !== "object") return valor;
  const chaves = Object.keys(valor).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(chaves.map((k) => [k, ordenarComoJsonb((valor as Linha)[k])]));
}

function entrada(kind: Entry["kind"], id: string, period: string, data: Linha): Entry {
  return { id, kind, period, data: ordenarComoJsonb(data) };
}

// ---------------------------------------------------------------------------
// Matriz tributária
// ---------------------------------------------------------------------------
function atividadeParaRegra(a: Linha): Activity {
  return {
    id: a.referencia, cnae: a.cnae, name: a.descricao, annex: a.anexo, lc116: a.item_lc116,
    nationalCode: a.codigo_tributacao_nacional, municipalCode: a.codigo_municipal ?? "",
    municipalRequired: a.exige_codigo_municipal, nbs: a.nbs ?? "", nbsRequired: a.exige_nbs,
    basis: a.fundamento, issRule: a.regra_iss,
  };
}

function tributacaoDaVersao(v: Linha | undefined, municipioEmpresa: string | null): Company["data"]["tax"] {
  if (!v) return { regime: "competencia", annex: "III", municipality: municipioEmpresa ?? "", service: "", factorR: false, version: 0, validated: false };
  const activities = [...(v.atividades_empresa ?? [])].sort((a, b) => a.ordem - b.ordem).map(atividadeParaRegra);
  return {
    regime: v.regime_apuracao, annex: v.anexo_principal, municipality: v.municipio,
    service: activities[0]?.name ?? "", factorR: v.fator_r, version: v.versao, validated: true, activities,
    // Cadastro inicial sem e-mail de confirmação ainda não foi confirmado pelo contador.
    ...(v.confirmado_por_email ? { confirmedAt: instante(v.confirmado_em) as string, confirmedBy: v.confirmado_por_email } : {}),
    effectiveFrom: v.vigencia_inicio,
  };
}

// ---------------------------------------------------------------------------
// Banco → regras
// ---------------------------------------------------------------------------
export type TabelasEmpresa = Partial<Record<Tabela | "convites", Linha[]>> & { empresa: Linha };

export function montarEmpresa(t: TabelasEmpresa): { company: Company; records: Entry[] } {
  const e = t.empresa;
  const versoes = [...(t.versoes_matriz_tributaria ?? [])].sort((a, b) => a.versao - b.versao);
  const company: Company = {
    id: e.id, name: e.razao_social, version: e.versao,
    data: {
      demo: e.demonstracao, cnpj: e.cnpj ?? "", email: e.email ?? "", phone: e.telefone ?? "", active: e.ativa,
      tax: tributacaoDaVersao(versoes.at(-1), e.municipio),
    },
  };

  const records: Entry[] = [];
  const contas = new Map((t.contas_bancarias ?? []).map((c) => [c.id, c.nome]));
  const periodoDocumento = new Map<string, string>();

  for (const r of t.competencias ?? []) records.push(entrada("period", r.id, r.competencia, {
    status: SITUACAO_COMPETENCIA.regra(r.situacao), bankConfirmed: r.extratos_confirmados, revenueConfirmed: r.receitas_confirmadas,
    noMovement: r.sem_movimento, lastBatch: r.ultimo_lote, snapshot: r.retrato, previousSnapshot: r.retrato_anterior,
    submittedAt: instante(r.enviada_em), reviewedAt: instante(r.revisada_em), reviewNote: r.parecer_revisao, approvedAt: instante(r.aprovada_em),
  }));

  for (const r of t.historico_receitas ?? []) records.push(entrada("history", r.id, r.competencia, {
    revenue: r.receita, ...(r.despesas != null ? { expenses: r.despesas } : {}), ...(r.folha != null ? { payroll: r.folha } : {}),
    payrollValidated: r.folha_validada, source: r.fonte, evidenceId: r.documento_evidencia_id,
    validatedAt: instante(r.validado_em), validatedBy: r.validado_por_email,
  }));

  for (const v of versoes) records.push(entrada("tax_version", v.id, v.vigencia_inicio, {
    before: v.retrato_anterior, after: tributacaoDaVersao(v, e.municipio), requestId: v.solicitacao_id,
    confirmedBy: v.confirmado_por_email, confirmedAt: instante(v.confirmado_em),
  }));

  for (const r of t.documentos ?? []) {
    const period = r.competencia ?? "permanent";
    periodoDocumento.set(r.id, period);
    const ciencias = [...(r.ciencias_documento ?? [])].sort((a, b) => String(a.ciente_em).localeCompare(String(b.ciente_em)));
    records.push(entrada("document", r.id, period, {
      name: r.nome, category: CATEGORIA_DOCUMENTO.regra(r.categoria), key: r.caminho_storage, size: r.tamanho_bytes,
      mime: r.tipo_mime, sha256: r.sha256, version: r.versao, previousId: r.documento_anterior_id,
      scope: r.escopo === "permanente" ? "permanent" : "monthly", uploadedAt: instante(r.enviado_em), uploadedBy: r.enviado_por_email,
      acknowledgments: ciencias.map((c) => ({ actorId: c.usuario_id, actor: c.usuario_email, at: instante(c.ciente_em) })),
      ...(ciencias.length ? { acknowledgedAt: instante(ciencias.at(-1)!.ciente_em) } : {}),
      archivedAt: instante(r.arquivado_em), archivedBy: r.arquivado_por_email,
      ...(r.tipo_exportacao ? { exportType: r.tipo_exportacao, sourceVersion: r.versao_origem } : {}),
    }));
  }
  for (const r of t.eventos_documento ?? []) records.push(entrada("document_event", r.id, periodoDocumento.get(r.documento_id) ?? "permanent", {
    documentId: r.documento_id, event: EVENTO_DOCUMENTO.regra(r.evento), actor: r.ator_email, actorId: r.ator_id,
    at: instante(r.ocorrido_em), detail: r.detalhe,
  }));

  for (const r of t.solicitacoes ?? []) records.push(entrada("request", r.id, r.competencia, {
    title: r.titulo, description: r.descricao, type: r.tipo, category: CATEGORIA_SOLICITACAO.regra(r.categoria === "geral" ? null : r.categoria),
    status: SITUACAO_SOLICITACAO.regra(r.situacao), owner: r.responsavel, due: r.prazo, quote: r.valor_orcamento,
    quoteScope: r.escopo_orcamento, acceptedAt: instante(r.aceito_em), requestedBy: r.solicitado_por_email,
    clientRequestEvidence: r.evidencia_solicitacao, appliedAt: instante(r.aplicado_em), taxVersion: r.versao_matriz_aplicada,
    createdAt: instante(r.criado_em),
  }));

  for (const r of t.contatos ?? []) records.push(entrada("contact", r.id, mes(r.criado_em), {
    name: r.nome, contactType: TIPO_CONTATO.regra(r.tipo), taxId: r.cpf_cnpj ?? "", email: r.email ?? "", phone: r.telefone ?? "",
    municipality: r.municipio, address: r.endereco ?? "", municipalRegistration: r.inscricao_municipal ?? "",
    zip: r.cep ?? "", street: r.logradouro ?? "", streetNumber: r.numero_endereco ?? "", complement: r.complemento ?? "",
    district: r.bairro ?? "", ibge: r.codigo_ibge ?? "", uf: r.uf ?? "",
    publicBody: r.orgao_publico, updatedAt: instante(r.atualizado_em),
  }));

  for (const r of t.notas_fiscais ?? []) records.push(entrada("invoice", r.id, r.competencia, {
    customer: r.tomador_nome, contactId: r.tomador_id, contactSnapshot: r.tomador_retrato, service: r.descricao_servico,
    serviceDate: r.data_servico, serviceLocation: r.local_prestacao, activityId: r.atividade_retrato?.id ?? null,
    activitySnapshot: r.atividade_retrato, taxVersion: r.versao_matriz, amount: r.valor_servicos, due: r.vencimento,
    issRetained: r.iss_retido, issStatus: SITUACAO_ISS.regra(r.situacao_iss), issSuggestion: r.sugestao_iss,
    ...(r.aliquota_iss != null ? { issRate: Number(r.aliquota_iss) } : {}), issAmount: r.valor_iss, issReview: r.revisao_iss,
    status: SITUACAO_NOTA.regra(r.situacao), number: r.numero, issuedAt: instante(r.emitida_em), createdAt: instante(r.criado_em),
  }));

  for (const r of t.movimentacoes_bancarias ?? []) records.push(entrada("transaction", r.id, r.competencia, {
    date: r.data, description: r.descricao, amount: r.valor, category: CATEGORIAS.regra(r.categoria), invoiceId: r.nota_fiscal_id,
    justification: r.justificativa, needsReview: r.precisa_revisao, classifiedAt: instante(r.classificado_em),
    otherReview: r.natureza_outras ? { nature: NATUREZA_OUTRAS.regra(r.natureza_outras), note: r.parecer_outras, by: r.revisado_outras_por, at: instante(r.revisado_outras_em) } : null,
    account: contas.get(r.conta_bancaria_id) ?? "Conta", source: r.arquivo_origem, fileHash: r.hash_arquivo, fitId: r.fit_id,
    // Open Finance: origem, id da transação no provedor e contraparte (cruzada com os cadastros na tela).
    origin: r.origem ?? "arquivo", externalId: r.id_externo ?? null, counterpartName: r.contraparte_nome ?? null,
    counterpartDoc: r.contraparte_documento ?? null, providerCategory: r.categoria_provedor ?? null,
  }));

  for (const r of t.regras_classificacao ?? []) records.push(entrada("rule", r.id, mes(r.criado_em), {
    pattern: r.padrao, category: CATEGORIAS.regra(r.categoria), active: r.ativa, mode: "suggest", createdAt: instante(r.criado_em),
  }));

  for (const r of t.contas_pagar ?? []) records.push(entrada("payable", r.id, r.competencia, {
    description: r.descricao, amount: r.valor, due: r.vencimento, category: CATEGORIAS.regra(r.categoria),
    status: SITUACAO_PAGAMENTO.regra(r.situacao), supplierId: r.fornecedor_id, supplierSnapshot: r.fornecedor_retrato,
    reportedAt: instante(r.informado_em),
  }));

  for (const r of t.notificacoes ?? []) records.push(entrada("notification", r.id, r.competencia, {
    title: r.titulo, body: r.corpo, sourceId: r.origem_id, documentId: r.documento_id, createdAt: instante(r.criado_em),
    channel: "portal", audience: r.publico === "escritorio" ? "office" : "client",
    readBy: (r.leituras_notificacao ?? []).map((l: Linha) => ({ id: l.usuario_id, email: "", at: instante(l.lida_em) })),
  }));

  for (const r of t.tarefas ?? []) {
    const id = r.origem_tipo === ORIGEM_REVISAO ? `${r.origem_id}${SUFIXO_REVISAO}` : r.id;
    records.push(entrada("task", id, r.competencia ?? mes(r.prazo), {
      title: r.titulo, description: r.descricao, category: r.categoria, owner: r.responsavel_nome, due: r.prazo,
      status: SITUACAO_TAREFA.regra(r.situacao), completedAt: instante(r.concluida_em), evidence: r.evidencia,
      sourceId: r.origem_id, requestId: r.solicitacao_id, createdAt: instante(r.criado_em),
    }));
  }

  for (const r of t.leads_comerciais ?? []) records.push(entrada("lead", r.id, mes(r.criado_em), {
    name: r.nome, email: r.email, package: r.pacote, status: SITUACAO_LEAD.regra(r.situacao), note: r.observacao,
    owner: r.responsavel, source: r.origem, createdAt: instante(r.criado_em), updatedAt: instante(r.atualizado_em),
  }));

  for (const r of t.assinaturas ?? []) records.push(entrada("subscription", r.id, r.competencia_inicio, {
    description: r.descricao, amount: r.valor, start: r.competencia_inicio, day: r.dia_vencimento, active: r.ativa,
    createdAt: instante(r.criado_em),
  }));

  for (const r of t.cobrancas ?? []) records.push(entrada("charge", r.id, r.competencia, {
    description: r.descricao, amount: r.valor, due: r.vencimento, status: SITUACAO_PAGAMENTO.regra(r.situacao),
    source: ORIGEM_COBRANCA.regra(r.origem), frequency: r.origem === "assinatura" ? "monthly" : "once",
    subscriptionId: r.assinatura_id, requestId: r.solicitacao_id, provider: "not_connected",
    reportedAt: instante(r.informado_em), createdAt: instante(r.criado_em),
  }));

  for (const r of t.colaboradores ?? []) records.push(entrada("employee", r.id, mes(r.inicio), {
    name: r.nome, employeeType: TIPO_COLABORADOR.regra(r.tipo), job: r.cargo, amount: r.remuneracao, start: r.inicio,
    esocialRegistration: r.matricula_esocial ?? "", status: r.situacao === "inativo" ? "inactive" : "active",
    updatedAt: instante(r.atualizado_em),
  }));

  for (const r of t.folhas_pagamento ?? []) records.push(entrada("payroll", r.id, r.competencia, {
    gross: r.proventos, discounts: r.descontos, charges: r.encargos, net: r.liquido,
    status: r.situacao === "revisada" ? "reviewed" : "draft", source: r.fonte, evidenceId: r.documento_evidencia_id,
    note: r.observacao, by: r.registrado_por, updatedAt: instante(r.atualizado_em),
  }));

  for (const c of t.configuracoes_contabeis ?? []) records.push(entrada("accounting", c.id, c.competencia_inicial, {
    type: "matrix",
    accounts: [...(c.plano_contas ?? [])].sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }))
      .map((p: Linha) => ({ code: p.codigo, name: p.nome, group: GRUPO_CONTA.regra(p.grupo), opening: p.saldo_inicial })),
    mappings: Object.fromEntries((c.mapeamentos_categoria_conta ?? []).map((m: Linha) => [CATEGORIAS.regra(m.categoria), m.conta_codigo])),
    bankAccount: c.conta_banco_codigo, startPeriod: c.competencia_inicial, taxId: c.cnpj_destino, branch: c.filial ?? "",
    version: c.versao, confirmedBy: c.confirmado_por, updatedAt: instante(c.atualizado_em),
  }));

  for (const f of t.fechamentos_contabeis ?? []) records.push(entrada("accounting", f.id, f.competencia, {
    type: "close", status: f.situacao === "revisado" ? "reviewed" : "open", reviewedAt: instante(f.revisado_em),
    reviewedBy: f.revisado_por, note: f.parecer, requestId: f.solicitacao_id, snapshot: f.retrato,
    reopenedAt: instante(f.reaberto_em), reason: f.motivo_reabertura,
  }));

  for (const j of t.lancamentos_contabeis ?? []) records.push(entrada("journal", j.id, j.competencia, {
    date: j.data, debit: j.conta_debito, credit: j.conta_credito, amount: j.valor, memo: j.historico,
    sourceId: j.movimentacao_id, sourceSnapshot: j.retrato_origem, matrixVersion: j.versao_configuracao,
    status: j.situacao === "validado" ? "validated" : "draft", validatedBy: j.validado_por,
    validatedAt: instante(j.validado_em), createdAt: instante(j.criado_em), updatedAt: instante(j.atualizado_em),
  }));

  for (const c of t.convites ?? []) records.push(entrada("invitation", c.id, mes(c.criado_em), {
    email: c.email, role: PAPEIS.regra(c.papel), status: c.situacao === "pendente" ? "prepared" : c.situacao,
    createdAt: instante(c.criado_em),
  }));

  return { company, records };
}

// ---------------------------------------------------------------------------
// Regras → banco
// ---------------------------------------------------------------------------
function paraLinhas(e: Entry, ctx: ContextoTraducao, novo: boolean): LinhaTabela[] {
  const d = e.data;
  const id = idBanco(e.id);
  const l = (tabela: Tabela, linha: Linha): LinhaTabela => ({ tabela, linha });

  switch (e.kind) {
    case "period":
      return [l("competencias", {
        id, competencia: e.period, situacao: SITUACAO_COMPETENCIA.banco(d.status ?? "open"),
        extratos_confirmados: !!d.bankConfirmed, receitas_confirmadas: !!d.revenueConfirmed, sem_movimento: !!d.noMovement,
        ultimo_lote: ou(d.lastBatch), retrato: ou(d.snapshot), retrato_anterior: ou(d.previousSnapshot),
        enviada_em: ou(d.submittedAt), revisada_em: ou(d.reviewedAt), parecer_revisao: ou(d.reviewNote), aprovada_em: ou(d.approvedAt),
      })];

    case "history":
      return [l("historico_receitas", {
        id, competencia: e.period, receita: d.revenue ?? 0, despesas: ou(d.expenses), folha: ou(d.payroll),
        folha_validada: !!d.payrollValidated, fonte: d.source || "Não informada", documento_evidencia_id: idOpcional(d.evidenceId),
        validado_em: ou(d.validatedAt), validado_por_email: ou(d.validatedBy),
      })];

    case "tax_version": {
      const after = d.after as Company["data"]["tax"];
      const linhas = [l("versoes_matriz_tributaria", {
        id, versao: after.version, regime_apuracao: after.regime, municipio: after.municipality, anexo_principal: after.annex,
        fator_r: !!after.factorR, vigencia_inicio: after.effectiveFrom || e.period, confirmado_por_email: ou(d.confirmedBy),
        confirmado_em: d.confirmedAt ?? new Date().toISOString(), solicitacao_id: idOpcional(d.requestId), retrato_anterior: ou(d.before),
        ...(novo && d.confirmedBy ? { confirmado_por: ctx.usuarioId } : {}),
      })];
      (after.activities ?? []).forEach((a, i) => linhas.push(l("atividades_empresa", {
        id: idBanco(`${id}:${a.id}`), versao_matriz_id: id, referencia: idBanco(a.id), cnae: a.cnae, descricao: a.name,
        anexo: a.annex, item_lc116: a.lc116, codigo_tributacao_nacional: a.nationalCode,
        exige_codigo_municipal: !!a.municipalRequired, codigo_municipal: a.municipalCode || null,
        exige_nbs: !!a.nbsRequired, nbs: a.nbs || null, fundamento: a.basis, regra_iss: a.issRule, ordem: i,
      })));
      return linhas;
    }

    case "document":
      return [
        l("documentos", {
          id, escopo: e.period === "permanent" ? "permanente" : "mensal", competencia: e.period === "permanent" ? null : e.period,
          categoria: CATEGORIA_DOCUMENTO.banco(d.category), nome: d.name, caminho_storage: d.key, tamanho_bytes: d.size,
          tipo_mime: d.mime, sha256: d.sha256, versao: d.version || 1, documento_anterior_id: idOpcional(d.previousId),
          tipo_exportacao: ou(d.exportType), versao_origem: ou(d.sourceVersion), enviado_por_email: ou(d.uploadedBy),
          enviado_em: d.uploadedAt ?? new Date().toISOString(), arquivado_em: ou(d.archivedAt), arquivado_por_email: ou(d.archivedBy),
          ...(novo ? { enviado_por: ctx.usuarioId } : {}),
        }),
        ...((d.acknowledgments ?? []) as Linha[]).map((a) => l("ciencias_documento", {
          documento_id: id, usuario_id: a.actorId, usuario_email: a.actor ?? "", ciente_em: a.at,
        })),
      ];

    case "document_event":
      return [l("eventos_documento", {
        id, documento_id: idBanco(d.documentId), evento: EVENTO_DOCUMENTO.banco(d.event), ator_id: d.actorId ?? ctx.usuarioId,
        ator_email: ou(d.actor), detalhe: d.detail ?? "", ocorrido_em: d.at ?? new Date().toISOString(),
      })];

    case "request":
      return [l("solicitacoes", {
        id, competencia: e.period, titulo: d.title, descricao: d.description ?? "", tipo: d.type || "Geral",
        categoria: CATEGORIA_SOLICITACAO.banco(d.category) ?? "geral", situacao: SITUACAO_SOLICITACAO.banco(d.status ?? "new"),
        responsavel: ou(d.owner), prazo: ou(d.due), valor_orcamento: ou(d.quote), escopo_orcamento: ou(d.quoteScope),
        aceito_em: ou(d.acceptedAt), solicitado_por_email: ou(d.requestedBy), evidencia_solicitacao: ou(d.clientRequestEvidence),
        aplicado_em: ou(d.appliedAt), versao_matriz_aplicada: ou(d.taxVersion),
        ...(d.createdAt ? { criado_em: d.createdAt } : {}), ...(novo ? { solicitado_por: ctx.usuarioId } : {}),
      })];

    case "contact":
      return [l("contatos", {
        id, nome: d.name, tipo: TIPO_CONTATO.banco(d.contactType), cpf_cnpj: d.taxId || null, email: d.email || null,
        telefone: d.phone || null, municipio: d.municipality, endereco: d.address || null,
        inscricao_municipal: d.municipalRegistration || null, orgao_publico: !!d.publicBody,
        cep: d.zip || null, logradouro: d.street || null, numero_endereco: d.streetNumber || null, complemento: d.complement || null,
        bairro: d.district || null, codigo_ibge: d.ibge || null, uf: d.uf || null,
      })];

    case "invoice": {
      const referencia = d.activityId ?? d.activitySnapshot?.id;
      return [l("notas_fiscais", {
        id, competencia: e.period, origem: "rascunho_portal", numero: ou(d.number), tomador_id: idOpcional(d.contactId),
        tomador_nome: d.customer, tomador_retrato: ou(d.contactSnapshot), descricao_servico: d.service,
        data_servico: ou(d.serviceDate), local_prestacao: ou(d.serviceLocation),
        atividade_id: referencia && d.taxVersion && ctx.idAtividade ? ctx.idAtividade(d.taxVersion, referencia) : null,
        atividade_retrato: ou(d.activitySnapshot), versao_matriz: ou(d.taxVersion), valor_servicos: d.amount, vencimento: ou(d.due),
        iss_retido: !!d.issRetained, situacao_iss: SITUACAO_ISS.banco(d.issStatus ?? "not_indicated"), aliquota_iss: ou(d.issRate),
        valor_iss: d.issAmount ?? 0, sugestao_iss: ou(d.issSuggestion), revisao_iss: ou(d.issReview),
        situacao: SITUACAO_NOTA.banco(d.status ?? "draft"), emitida_em: ou(d.issuedAt), ...(d.createdAt ? { criado_em: d.createdAt } : {}),
      })];
    }

    case "transaction": {
      const nomeConta = String(d.account || "Conta principal");
      const contaId = idBanco(`${ctx.empresaId}:conta:${normalize(nomeConta)}`);
      const revisao = d.otherReview as Linha | null | undefined;
      return [
        l("contas_bancarias", { id: contaId, nome: nomeConta.slice(0, 80), nome_normalizado: normalize(nomeConta) }),
        l("movimentacoes_bancarias", {
          id, competencia: e.period, conta_bancaria_id: contaId, data: d.date, descricao: d.description, valor: d.amount,
          categoria: CATEGORIAS.banco(d.category), nota_fiscal_id: idOpcional(d.invoiceId), justificativa: ou(d.justification),
          precisa_revisao: !!d.needsReview, classificado_em: ou(d.classifiedAt),
          natureza_outras: revisao ? NATUREZA_OUTRAS.banco(revisao.nature) : null, parecer_outras: revisao?.note ?? null,
          revisado_outras_por: revisao?.by ?? null, revisado_outras_em: revisao?.at ?? null,
          arquivo_origem: ou(d.source), hash_arquivo: ou(d.fileHash), fit_id: ou(d.fitId),
          origem: d.origin ?? "arquivo", id_externo: ou(d.externalId), contraparte_nome: ou(d.counterpartName),
          contraparte_documento: ou(d.counterpartDoc), categoria_provedor: ou(d.providerCategory),
        }),
      ];
    }

    case "rule":
      return [l("regras_classificacao", {
        id, padrao: d.pattern, categoria: CATEGORIAS.banco(d.category), ativa: d.active !== false, modo: "sugerir",
        ...(d.createdAt ? { criado_em: d.createdAt } : {}),
      })];

    case "payable":
      return [l("contas_pagar", {
        id, competencia: e.period, descricao: d.description, valor: d.amount, vencimento: d.due, categoria: CATEGORIAS.banco(d.category),
        situacao: SITUACAO_PAGAMENTO.banco(d.status ?? "pending"), fornecedor_id: idOpcional(d.supplierId),
        fornecedor_retrato: ou(d.supplierSnapshot), informado_em: ou(d.reportedAt),
      })];

    case "notification":
      return [
        l("notificacoes", {
          id, competencia: e.period, titulo: d.title, corpo: d.body, publico: d.audience === "office" ? "escritorio" : "cliente",
          canal: "portal", origem_id: ou(d.sourceId), documento_id: idOpcional(d.documentId),
          ...(d.createdAt ? { criado_em: d.createdAt } : {}),
        }),
        ...((d.readBy ?? []) as Linha[]).map((r) => l("leituras_notificacao", { notificacao_id: id, usuario_id: r.id, lida_em: r.at })),
      ];

    case "task": {
      const revisao = e.id.endsWith(SUFIXO_REVISAO);
      return [l("tarefas", {
        id, escritorio_id: ctx.escritorioId, competencia: e.period, titulo: d.title, descricao: d.description ?? "",
        categoria: d.category || "Entrega", responsavel_nome: d.owner || "Contador responsável", prazo: d.due,
        situacao: SITUACAO_TAREFA.banco(d.status ?? "pending"), concluida_em: ou(d.completedAt), evidencia: ou(d.evidence),
        origem_tipo: revisao ? ORIGEM_REVISAO : null,
        origem_id: revisao ? idBanco(e.id.slice(0, -SUFIXO_REVISAO.length)) : null,
        solicitacao_id: idOpcional(d.requestId), ...(d.createdAt ? { criado_em: d.createdAt } : {}),
      })];
    }

    case "lead":
      return [l("leads_comerciais", {
        id, escritorio_id: ctx.escritorioId, empresa_id: ctx.empresaId, nome: d.name, email: d.email, pacote: d.package,
        situacao: SITUACAO_LEAD.banco(d.status ?? "incomplete"), observacao: ou(d.note), responsavel: d.owner || "Comercial",
        origem: d.source || "Registro manual", ...(d.createdAt ? { criado_em: d.createdAt } : {}),
      })];

    case "subscription":
      return [l("assinaturas", {
        id, escritorio_id: ctx.escritorioId, descricao: d.description, valor: d.amount, competencia_inicio: d.start,
        dia_vencimento: d.day, ativa: d.active !== false, ...(d.createdAt ? { criado_em: d.createdAt } : {}),
      })];

    case "charge":
      return [l("cobrancas", {
        id, escritorio_id: ctx.escritorioId, competencia: e.period, descricao: d.description, valor: d.amount, vencimento: d.due,
        situacao: SITUACAO_PAGAMENTO.banco(d.status ?? "pending"), origem: ORIGEM_COBRANCA.banco(d.source ?? "one_off"),
        assinatura_id: idOpcional(d.subscriptionId), solicitacao_id: idOpcional(d.requestId), provedor: "nao_conectado",
        informado_em: ou(d.reportedAt), ...(d.createdAt ? { criado_em: d.createdAt } : {}),
      })];

    case "employee":
      return [l("colaboradores", {
        id, nome: d.name, tipo: TIPO_COLABORADOR.banco(d.employeeType), cargo: d.job, remuneracao: d.amount, inicio: d.start,
        matricula_esocial: d.esocialRegistration || null, situacao: d.status === "inactive" ? "inativo" : "ativo",
      })];

    case "payroll":
      return [l("folhas_pagamento", {
        id, competencia: e.period, proventos: d.gross, descontos: d.discounts, encargos: d.charges,
        situacao: d.status === "reviewed" ? "revisada" : "rascunho", fonte: d.source || "Cálculo externo informado pelo contador",
        documento_evidencia_id: idOpcional(d.evidenceId), observacao: d.note ?? "", registrado_por: d.by ?? "",
      })];

    case "journal":
      return [l("lancamentos_contabeis", {
        id, competencia: e.period, data: d.date, conta_debito: d.debit, conta_credito: d.credit, valor: d.amount, historico: d.memo,
        movimentacao_id: idOpcional(d.sourceId), retrato_origem: ou(d.sourceSnapshot), versao_configuracao: d.matrixVersion,
        situacao: d.status === "validated" ? "validado" : "rascunho", validado_por: ou(d.validatedBy), validado_em: ou(d.validatedAt),
        ...(d.createdAt ? { criado_em: d.createdAt } : {}),
      })];

    case "accounting": {
      if (d.type === "close") return [l("fechamentos_contabeis", {
        id, competencia: e.period, situacao: d.status === "reviewed" ? "revisado" : "aberto", revisado_em: ou(d.reviewedAt),
        revisado_por: ou(d.reviewedBy), parecer: ou(d.note), solicitacao_id: idOpcional(d.requestId), retrato: ou(d.snapshot),
        reaberto_em: ou(d.reopenedAt), motivo_reabertura: ou(d.reason),
      })];
      const contas = (d.accounts ?? []) as Linha[];
      return [
        l("configuracoes_contabeis", {
          id, versao: d.version ?? 1, competencia_inicial: d.startPeriod, conta_banco_codigo: d.bankAccount, cnpj_destino: d.taxId,
          filial: d.branch || null, confirmado_por: d.confirmedBy ?? "",
        }),
        ...contas.map((c) => l("plano_contas", {
          id: idBanco(`${ctx.empresaId}:conta-contabil:${c.code}`), configuracao_id: id, codigo: c.code, nome: c.name,
          grupo: GRUPO_CONTA.banco(c.group), saldo_inicial: c.opening ?? 0,
        })),
        ...Object.entries((d.mappings ?? {}) as Record<string, string>).map(([categoria, codigo]) => l("mapeamentos_categoria_conta", {
          configuracao_id: id, categoria: CATEGORIAS.banco(categoria), conta_codigo: codigo,
        })),
      ];
    }

    // Convites têm fluxo próprio (token); não passam por aqui.
    case "invitation":
      return [];
  }
  return [];
}

const chaveDaLinha = ({ tabela, linha }: LinhaTabela) => `${tabela}|${(CHAVES[tabela] ?? ["id"]).map((c) => linha[c]).join("|")}`;
const comparavel = (linha: Linha) => JSON.stringify(ordenarComoJsonb(linha));

/**
 * Converte as alterações de uma ação em linhas a gravar, na ordem das chaves
 * estrangeiras, enviando apenas o que de fato mudou em relação ao que foi carregado.
 */
export function linhasAlteradas(upserts: Entry[], antes: Map<string, Entry>, ctx: ContextoTraducao): LinhaTabela[] {
  const anteriores = new Map<string, string>();
  for (const e of upserts) {
    const original = antes.get(e.id);
    if (original) for (const lt of paraLinhas(original, ctx, false)) anteriores.set(chaveDaLinha(lt), comparavel(lt.linha));
  }
  const saida = new Map<string, LinhaTabela>();
  for (const e of upserts) {
    for (const lt of paraLinhas(e, ctx, !antes.has(e.id))) {
      const chave = chaveDaLinha(lt);
      const semAlteracao = anteriores.get(chave) === comparavel(lt.linha);
      if (semAlteracao) saida.delete(chave);
      else saida.set(chave, lt);
    }
  }
  const posicao = (t: Tabela) => ORDEM_TABELAS.indexOf(t);
  return [...saida.values()].sort((a, b) => posicao(a.tabela) - posicao(b.tabela));
}
