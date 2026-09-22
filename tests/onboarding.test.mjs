import assert from "node:assert/strict";
import test from "node:test";
import { ETAPAS, PLANOS, cnpjValido, dadosDaBrasilApi } from "../.domain-tests/onboarding.mjs";

test("CNPJ: dígitos verificadores e sequências repetidas", () => {
  assert.equal(cnpjValido("63.172.986/0001-05"), true);
  assert.equal(cnpjValido("11222333000181"), true);
  assert.equal(cnpjValido("63172986000106"), false);
  assert.equal(cnpjValido("11111111111111"), false);
  assert.equal(cnpjValido("123"), false);
});

test("BrasilAPI: endereço, município com IBGE, telefone e CNAE", () => {
  const d = dadosDaBrasilApi({
    cnpj: "63172986000105", razao_social: "BI2B CONSULTORIA LTDA", nome_fantasia: "", cep: "77015032",
    descricao_tipo_de_logradouro: "QUADRA", logradouro: "QUADRA ACSO 11 RUA SO 9", numero: "17", complemento: "CONJ 02 LOTE 26 CASA 08",
    bairro: "PLANO DIRETOR SUL", municipio: "PALMAS", uf: "TO", codigo_municipio_ibge: 1721000, email: null, ddd_telefone_1: "6392812239",
    cnae_fiscal: 6920601, cnae_fiscal_descricao: "Atividades de contabilidade", opcao_pelo_simples: true, descricao_situacao_cadastral: "ATIVA",
  });
  assert.equal(d.logradouro, "QUADRA ACSO 11 RUA SO 9");
  assert.equal(d.municipio, "Palmas / TO");
  assert.equal(d.codigoIbge, "1721000");
  assert.equal(d.telefone, "(63) 92812239");
  assert.equal(d.cnaePrincipal, "6920601");
  assert.equal(d.nomeFantasia, null);
  assert.equal(d.simples, true);
  const lem = dadosDaBrasilApi({ cnpj: "1", razao_social: "X", municipio: "LUIS EDUARDO MAGALHAES", uf: "BA", descricao_tipo_de_logradouro: "RUA", logradouro: "DAS PALMEIRAS" });
  assert.equal(lem.municipio, "Luis Eduardo Magalhaes / BA");
  assert.equal(lem.logradouro, "RUA DAS PALMEIRAS");
});

test("planos e etapas da página inicial", () => {
  assert.deepEqual(Object.keys(PLANOS), ["essencial", "gestao", "estrategia"]);
  assert.equal(ETAPAS.length, 5);
  assert.match(ETAPAS[4].titulo, /Grade tributária/);
});
