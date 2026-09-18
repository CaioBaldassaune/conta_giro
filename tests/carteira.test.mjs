import assert from "node:assert/strict";
import test from "node:test";
import { classificar, prazoPgdas } from "../.domain-tests/carteira.mjs";

const base = {
  razao_social: "Empresa", competencia_situacao: "aberta", matriz_confirmada: true, lancamentos_pendentes: 0,
  outras_entradas_pendentes: 0, chamados_aguardando_escritorio: 0, tarefas_atrasadas: 0, cobrancas_vencidas: 0,
  pgdas_transmitida: null, das_pago: null, das_vencimento: null, caixa_postal_novas: null, situacao_fiscal: null,
};
const textos = (l) => l.alertas.map((a) => a.texto);

test("PGDAS-D e DAS vencem no dia 20 do mês seguinte, inclusive na virada do ano", () => {
  assert.equal(prazoPgdas("2026-08"), "2026-09-20");
  assert.equal(prazoPgdas("2026-12"), "2027-01-20");
});

test("sem SERPRO, apuração vencida e não revisada é crítica; perto do prazo é atenção", () => {
  assert.equal(classificar(base, "2026-08", "2026-09-21").risco, 2);
  assert.ok(textos(classificar(base, "2026-08", "2026-09-21")).includes("Apuração atrasada"));
  assert.deepEqual(textos(classificar(base, "2026-08", "2026-09-18")), ["Apuração vence em 2 dia(s)"]);
  assert.equal(classificar({ ...base, competencia_situacao: "revisada" }, "2026-08", "2026-09-25").risco, 0);
});

test("dados do SERPRO têm prioridade: PGDAS-D entregue não alerta; DAS vencido é crítico", () => {
  assert.equal(classificar({ ...base, pgdas_transmitida: true, das_pago: true }, "2026-08", "2026-09-25").risco, 0);
  const vencido = classificar({ ...base, pgdas_transmitida: true, das_pago: false, das_vencimento: "2026-09-20" }, "2026-08", "2026-09-25");
  assert.equal(vencido.risco, 2);
  assert.ok(textos(vencido).includes("DAS vencido"));
});

test("chamados aguardando o escritório e pendências aparecem como atenção", () => {
  const l = classificar({ ...base, competencia_situacao: "revisada", chamados_aguardando_escritorio: 2, lancamentos_pendentes: 5 }, "2026-08", "2026-09-10");
  assert.equal(l.risco, 1);
  assert.deepEqual(textos(l), ["2 chamado(s) aguardando o escritório", "5 lançamento(s) sem classificação"]);
});
