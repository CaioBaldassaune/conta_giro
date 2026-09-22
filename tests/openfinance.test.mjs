import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { casarContraparte, diaAnterior, extratoDeExemplo, lerExtratoOpenFinance, situacaoProtocolo, sugestaoPorContraparte } from "../.domain-tests/openfinance.mjs";

// Exemplo oficial da resposta de GET /statement/openfinance/{uniqueId} (docs/openfinance/tecnospeed/api.json).
const api = JSON.parse(readFileSync("docs/openfinance/tecnospeed/api.json", "utf8"));
const oficial = api.paths["/api/v1/statement/openfinance/{uniqueId}"].get.responses["200"].examples?.["application/json"]
  ?? api.paths["/api/v1/statement/openfinance/{uniqueId}"].get.responses["200"].schema.example;

const contato = (id, name, taxId) => ({ id, kind: "contact", period: "2026-09", data: { name, taxId, contactType: "both" } });
const mov = (id, date, amount, category, counterpartDoc, counterpartName) => ({ id, kind: "transaction", period: date.slice(0, 7), data: { date, amount, category, counterpartDoc, counterpartName } });

test("extrato oficial da TecnoSpeed: crédito com o pagador, débito com o recebedor, duplicados ignorados", () => {
  assert.equal(situacaoProtocolo(oficial), "concluido");
  const movs = lerExtratoOpenFinance(oficial);
  // O exemplo usa o mesmo transactionId no crédito e no débito: entra uma vez só (o crédito).
  assert.equal(movs.length, 1);
  const [credito] = movs;
  assert.deepEqual(credito, { externalId: "048ffd42-4ae0-4344-9c51-c60a2b406dea", date: "2024-10-20", description: "DL*GOOGLEYouTube", amount: 1899, counterpartName: "John Doe", counterpartDoc: "12345678900", providerCategory: "Digital services" });
});

test("extrato de exemplo: 3 entradas e 5 saídas, ids estáveis por data", () => {
  const movs = lerExtratoOpenFinance(extratoDeExemplo("2026-09-20"));
  assert.equal(movs.filter((m) => m.amount > 0).length, 3);
  assert.equal(movs.filter((m) => m.amount < 0).length, 5);
  assert.deepEqual(movs.find((m) => m.externalId === "exemplo-2026-09-20-4"), {
    externalId: "exemplo-2026-09-20-4", date: "2026-09-20", description: "PAGTO BOLETO IMOBILIARIA LEM", amount: -220000,
    counterpartName: "Imobiliária Luís Eduardo Magalhães Ltda", counterpartDoc: "10000003000189", providerCategory: "Rent",
  });
  // Tarifa bancária não tem contraparte identificada.
  assert.equal(movs.find((m) => m.externalId.endsWith("-8")).counterpartDoc, null);
  assert.deepEqual(lerExtratoOpenFinance(extratoDeExemplo("2026-09-20")).map((m) => m.externalId), movs.map((m) => m.externalId));
});

test("cruzamento com cadastros: CPF/CNPJ primeiro, depois nome sem acento e maiúsculas", () => {
  const contatos = [contato("c1", "Imobiliária LEM", "10.000.003/0001-89"), contato("c2", "Transportes Chapada Diamantina Ltda", "")];
  assert.equal(casarContraparte({ counterpartDoc: "10000003000189", counterpartName: "Outro nome" }, contatos).contato.id, "c1");
  const porNome = casarContraparte({ counterpartDoc: "10000002000134", counterpartName: "TRANSPORTES CHAPADA DIAMANTINA LTDA" }, contatos);
  assert.equal(porNome.contato.id, "c2");
  assert.equal(porNome.por, "nome");
  assert.equal(casarContraparte({ counterpartDoc: "52998224725", counterpartName: "Maria Santos Oliveira" }, contatos), null);
  assert.equal(casarContraparte({ counterpartDoc: null, counterpartName: "ABC" }, contatos), null);
});

test("sugestão pelo histórico da contraparte só quando há uma categoria única", () => {
  const historico = [
    mov("t1", "2026-08-10", -220000, "rent", "10000003000189", "Imobiliária"),
    mov("t2", "2026-07-10", -220000, "rent", "10000003000189", "Imobiliária"),
    mov("t3", "2026-08-12", -12990, "telecom", "10000005000178", "Fibra"),
    mov("t4", "2026-07-12", -12990, "software", "10000005000178", "Fibra"),
  ];
  assert.equal(sugestaoPorContraparte({ id: "n1", amount: -220000, counterpartDoc: "10000003000189" }, historico), "rent");
  assert.equal(sugestaoPorContraparte({ id: "n2", amount: -12990, counterpartDoc: "10000005000178" }, historico), null);
  assert.equal(sugestaoPorContraparte({ id: "n3", amount: 220000, counterpartDoc: "10000003000189" }, historico), null);
  assert.equal(sugestaoPorContraparte({ id: "n4", amount: -100, counterpartDoc: null, counterpartName: null }, historico), null);
});

test("D+1 busca o dia anterior no horário de Brasília", () => {
  assert.equal(diaAnterior(new Date("2026-09-21T12:00:00Z")), "2026-09-20");
  assert.equal(diaAnterior(new Date("2026-09-21T02:00:00Z")), "2026-09-19"); // 23h do dia 20 em Brasília
});
