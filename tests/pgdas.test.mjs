import assert from "node:assert/strict";
import test from "node:test";
import { atividadeSimples, lerResultado, mesesAnteriores, montarDeclaracao, proporReceitas } from "../.domain-tests/pgdas.mjs";

const base = { cnpj: "63172986000105", competencia: "2026-08", tipo: 1 };

test("atividade do PGDAS-D vem do anexo da matriz e da retenção de ISS", () => {
  assert.equal(atividadeSimples("III", false), 14);
  assert.equal(atividadeSimples("III", true), 15);
  assert.equal(atividadeSimples("factor_r", false), 11);
  assert.equal(atividadeSimples("V", true), 12);
  assert.equal(atividadeSimples("IV", false), 17);
});

test("notas da competência viram receitas por atividade; outro município gera aviso", () => {
  const { receitas, avisos } = proporReceitas([
    { valor: 100000, anexo: "III", issRetido: false, outroMunicipio: false },
    { valor: 50000, anexo: "III", issRetido: false, outroMunicipio: false },
    { valor: 20000, anexo: "factor_r", issRetido: true, outroMunicipio: true, numero: "7" },
  ]);
  assert.deepEqual(receitas, [{ idAtividade: 12, valor: 20000 }, { idAtividade: 14, valor: 150000 }]);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /Nota 7/);
});

test("sem faturamento: receita zero, estabelecimento sem atividades e transmissão sem comparação", () => {
  const d = montarDeclaracao({ ...base, receitas: [], transmitir: true });
  assert.equal(d.pa, 202608);
  assert.equal(d.indicadorTransmissao, true);
  assert.equal(d.indicadorComparacao, false);
  assert.equal(d.declaracao.receitaPaCompetenciaInterno, 0);
  assert.deepEqual(d.declaracao.estabelecimentos, [{ cnpjCompleto: "63172986000105" }]);
  assert.equal("valoresParaComparacao" in d, false);
});

test("com receita: prévia não transmite; transmissão exige os valores da prévia", () => {
  const receitas = [{ idAtividade: 14, valor: 150075 }];
  const previa = montarDeclaracao({ ...base, receitas, transmitir: false });
  assert.equal(previa.indicadorTransmissao, false);
  assert.equal(previa.indicadorComparacao, false);
  assert.equal(previa.declaracao.receitaPaCompetenciaInterno, 1500.75);
  assert.deepEqual(previa.declaracao.estabelecimentos[0].atividades, [{ idAtividade: 14, valorAtividade: 1500.75, receitasAtividade: [{ valor: 1500.75 }] }]);
  assert.throws(() => montarDeclaracao({ ...base, receitas, transmitir: true }), /prévia/);
  const valores = [{ codigoTributo: 1010, valor: 30.02 }];
  const envio = montarDeclaracao({ ...base, receitas, transmitir: true, valoresParaComparacao: valores });
  assert.equal(envio.indicadorComparacao, true);
  assert.deepEqual(envio.valoresParaComparacao, valores);
});

test("Fator R leva as folhas dos 12 meses anteriores; validações de entrada", () => {
  assert.deepEqual(mesesAnteriores("2026-02", 3), ["2025-11", "2025-12", "2026-01"]);
  const folhas = mesesAnteriores("2026-08").map((competencia) => ({ competencia, valor: 300000 }));
  const d = montarDeclaracao({ ...base, receitas: [{ idAtividade: 11, valor: 100000 }], folhas, transmitir: false });
  assert.equal(d.declaracao.folhasSalario.length, 12);
  assert.deepEqual(d.declaracao.folhasSalario[0], { pa: 202508, valor: 3000 });
  assert.equal("folhasSalario" in montarDeclaracao({ ...base, receitas: [{ idAtividade: 14, valor: 100 }], folhas, transmitir: false }).declaracao, false);
  assert.throws(() => montarDeclaracao({ ...base, receitas: [{ idAtividade: 1, valor: 100 }], transmitir: false }), /não suportada/);
  assert.throws(() => montarDeclaracao({ ...base, receitas: [{ idAtividade: 14, valor: 0 }], transmitir: false }), /maior que zero/);
  assert.throws(() => montarDeclaracao({ ...base, receitas: [{ idAtividade: 14, valor: 1 }, { idAtividade: 14, valor: 2 }], transmitir: false }), /uma única vez/);
});

test("retorno do SERPRO: id, data, total em centavos e PDFs", () => {
  const r = lerResultado({ idDeclaracao: "63172986202608001", dataHoraTransmissao: "20260918153012",
    valoresDevidos: [{ codigoTributo: 1001, valor: 44 }, { codigoTributo: 1010, valor: 22.08 }], declaracao: "JVBER", recibo: "JVBERr", notificacaoMaed: null, darf: null });
  assert.equal(r.idDeclaracao, "63172986202608001");
  assert.equal(r.transmitidaEm, "2026-09-18T15:30:12-03:00");
  assert.equal(r.totalDevido, 6608);
  assert.equal(r.pdfRecibo, "JVBERr");
  assert.equal(r.pdfMaed, null);
  assert.equal(lerResultado([{ valoresDevidos: [] }]).totalDevido, 0);
});
