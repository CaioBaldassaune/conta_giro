import assert from "node:assert/strict";
import test from "node:test";
import { linhasAlteradas, montarEmpresa, idBanco } from "../.domain-tests/traducao.mjs";
import { applyAction } from "../.domain-tests/contagiro.mjs";
import { demoCompany, demoRecords } from "../.domain-tests/seed.mjs";

const EMPRESA = "0b8e2c1a-5f3d-4c7e-9a10-2b3c4d5e6f70";
const ESCRITORIO = "1c9f3d2b-6a4e-4d8f-8b21-3c4d5e6f7a81";
const USUARIO = "2dab4e3c-7b5f-4e90-9c32-4d5e6f7a8b92";
const ctx = { empresaId: EMPRESA, escritorioId: ESCRITORIO, usuarioId: USUARIO };
const actor = { id: USUARIO, email: "contador@teste.dev" };

// Simula o que o Postgres devolveria: aplica upserts por chave, preenche padrões e
// embute relacionamentos como o PostgREST faz nas consultas do repositório.
function banco() {
  const tabelas = new Map();
  const chave = (t, l) => t === "ciencias_documento" ? `${l.documento_id}|${l.usuario_id}` : t === "leituras_notificacao" ? `${l.notificacao_id}|${l.usuario_id}` : t === "mapeamentos_categoria_conta" ? `${l.configuracao_id}|${l.categoria}` : l.id;
  let versao = 0;
  return {
    get versao() { return versao; },
    gravar(linhas) {
      versao++;
      for (const { tabela, linha } of linhas) {
        const t = tabelas.get(tabela) ?? new Map();
        const k = chave(tabela, linha);
        t.set(k, { criado_em: "2026-09-01T12:00:00.000Z", atualizado_em: "2026-09-01T12:00:00.000Z", ...t.get(k), ...linha, empresa_id: EMPRESA });
        tabelas.set(tabela, t);
      }
    },
    carregar() {
      const lista = (t) => [...(tabelas.get(t)?.values() ?? [])].map((l) => JSON.parse(JSON.stringify(l)));
      const embutir = (pais, filhos, fk) => pais.map((p) => ({ ...p, [filhos]: lista(filhos).filter((f) => f[fk] === p.id) }));
      const folhas = lista("folhas_pagamento").map((f) => ({ ...f, liquido: f.proventos - f.descontos }));
      const t = {
        empresa: { id: EMPRESA, escritorio_id: ESCRITORIO, razao_social: "Empresa Teste", versao, demonstracao: true, ativa: true, municipio: "São Paulo / SP" },
        versoes_matriz_tributaria: embutir(lista("versoes_matriz_tributaria"), "atividades_empresa", "versao_matriz_id"),
        documentos: embutir(lista("documentos"), "ciencias_documento", "documento_id"),
        notificacoes: embutir(lista("notificacoes"), "leituras_notificacao", "notificacao_id"),
        configuracoes_contabeis: embutir(embutir(lista("configuracoes_contabeis"), "plano_contas", "configuracao_id"), "mapeamentos_categoria_conta", "configuracao_id"),
        folhas_pagamento: folhas,
      };
      for (const nome of ["competencias", "historico_receitas", "eventos_documento", "solicitacoes", "contatos", "notas_fiscais", "contas_bancarias", "movimentacoes_bancarias", "regras_classificacao", "contas_pagar", "tarefas", "leads_comerciais", "assinaturas", "cobrancas", "colaboradores", "lancamentos_contabeis", "fechamentos_contabeis"]) t[nome] = lista(nome);
      return montarEmpresa(t);
    },
  };
}

function semear() {
  const db = banco();
  const base = demoCompany(EMPRESA, "Empresa Teste");
  const cadastro = { id: "cadastro-inicial", kind: "tax_version", period: "2026-08", data: { before: null, after: { ...base.data.tax, version: 1, effectiveFrom: "2026-08", activities: [] }, requestId: null, confirmedBy: null, confirmedAt: "2026-09-01T12:00:00.000Z" } };
  db.gravar(linhasAlteradas([cadastro, ...demoRecords(EMPRESA)], new Map(), ctx));
  return db;
}

function aplicar(db, estado, acao, role = "accountant") {
  const change = applyAction(estado.company, estado.records, role, { period: "2026-08", ...acao }, "2026-09-10T15:30:00.000Z", actor);
  const linhas = linhasAlteradas(change.upserts, new Map(estado.records.map((r) => [r.id, r])), ctx);
  db.gravar(linhas);
  return { linhas, estado: db.carregar() };
}

test("dados de demonstração voltam do banco com a mesma forma e valores", () => {
  const original = demoRecords(EMPRESA);
  const { company, records } = semear().carregar();
  assert.equal(company.data.tax.version, 1);
  assert.equal(company.data.tax.validated, true);
  assert.equal(company.data.tax.confirmedAt, undefined, "cadastro inicial ainda não confirmado pelo contador");
  for (const kind of ["period", "history", "invoice", "transaction", "rule", "payable", "request", "charge"]) {
    assert.equal(records.filter((r) => r.kind === kind).length, original.filter((r) => r.kind === kind).length, kind);
  }
  const tx = records.find((r) => r.id === idBanco(`${EMPRESA}:tx1`));
  assert.equal(tx.data.amount, 920000);
  assert.equal(tx.data.category, "revenue");
  assert.equal(tx.data.invoiceId, idBanco(`${EMPRESA}:001`));
  assert.equal(tx.data.account, "Conta principal • demonstração");
  const hist = records.filter((r) => r.kind === "history").sort((a, b) => a.period.localeCompare(b.period));
  assert.equal(hist[0].period, "2025-08");
  assert.equal(hist[0].data.revenue, 1800000);
  assert.ok(hist[0].data.expenses > 0);
});

test("uma classificação grava só a movimentação e a competência alteradas", () => {
  const db = semear();
  const estado = db.carregar();
  const vivo = estado.records.find((r) => r.kind === "transaction" && r.data.description.startsWith("VIVO"));
  const { linhas, estado: depois } = aplicar(db, estado, { type: "classify", ids: [vivo.id], category: "telecom" });
  assert.deepEqual(linhas.map((l) => l.tabela).sort(), ["competencias", "movimentacoes_bancarias"]);
  assert.equal(depois.records.find((r) => r.id === vivo.id).data.category, "telecom");
});

test("desfazer lote funciona após ida e volta pelo banco (horários idênticos)", () => {
  const db = semear();
  let estado = db.carregar();
  const tarifa = estado.records.find((r) => r.kind === "transaction" && r.data.description.startsWith("TARIFA"));
  estado = aplicar(db, estado, { type: "classify", ids: [tarifa.id], category: "bank" }).estado;
  estado = aplicar(db, estado, { type: "undo_classification" }).estado;
  assert.equal(estado.records.find((r) => r.id === tarifa.id).data.category, null);
});

test("outras entradas criam tarefa de revisão que é reencontrada pelo id da regra", () => {
  const db = semear();
  let estado = db.carregar();
  const aporte = estado.records.find((r) => r.kind === "transaction" && r.data.description.startsWith("CREDITO"));
  estado = aplicar(db, estado, { type: "classify", ids: [aporte.id], category: "other_revenue" }, "owner").estado;
  const tarefa = estado.records.find((r) => r.kind === "task");
  assert.equal(tarefa.id, `${aporte.id}:other-review`);
  assert.ok(estado.records.some((r) => r.kind === "notification"));
  estado = aplicar(db, estado, { type: "review_other", id: aporte.id, nature: "non_revenue", note: "Aporte do sócio conferido" }).estado;
  assert.equal(estado.records.find((r) => r.kind === "task").data.status, "done");
  assert.equal(estado.records.find((r) => r.id === aporte.id).data.otherReview.nature, "non_revenue");
});

test("matriz tributária confirmada pelo contador vira nova versão com atividades", () => {
  const db = semear();
  let estado = db.carregar();
  const atividade = { id: "8f0e6c4a-1b2d-4e3f-9a5b-6c7d8e9f0a1b", cnae: "8211300", name: "Serviços combinados de escritório", annex: "III", lc116: "17.02", nationalCode: "170201", municipalCode: "", municipalRequired: false, nbsRequired: false, nbs: "", basis: "Cenário fictício.", issRule: "Conferir legislação municipal." };
  estado = aplicar(db, estado, { type: "matrix_save", regime: "competencia", municipality: "São Paulo / SP", activities: [atividade], confirm: true }).estado;
  assert.equal(estado.company.data.tax.version, 2);
  assert.equal(estado.company.data.tax.activities[0].id, atividade.id);
  assert.equal(estado.company.data.tax.confirmedBy, "contador@teste.dev");
  assert.ok(estado.records.some((r) => r.kind === "tax_version" && r.data.after.version === 2));
});
