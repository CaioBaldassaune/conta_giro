import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import forge from "node-forge";
import { dataHoraBrasilia, idDps, montarDps } from "../.domain-tests/nfse/dps.mjs";
import { assinarDps, assinaturaValida } from "../.domain-tests/nfse/assinatura.mjs";

const XSD = path.resolve("docs/nfse/esquemas/1.01/DPS_v1.01.xsd");
const pasta = mkdtempSync(path.join(tmpdir(), "nfse-"));

// Valida contra o XSD oficial com lxml (Python). Sem Python/lxml, o teste é pulado.
function validarXsd(xml, nome) {
  const arquivo = path.join(pasta, `${nome}.xml`);
  writeFileSync(arquivo, xml, "utf8");
  const r = spawnSync("python", ["scripts/validar-xsd.py", XSD, arquivo], { encoding: "utf8" });
  if (r.error || /No module named/.test(r.stderr)) return { pulado: true };
  return { ok: r.status === 0, saida: (r.stdout + r.stderr).trim() };
}

// Cenário do primeiro cliente piloto (ME no Simples Nacional, Luís Eduardo Magalhães - BA).
const base = () => ({
  ambiente: "producao_restrita",
  emitidaEm: new Date("2026-09-18T15:00:00Z"),
  serie: "1",
  numero: 1,
  dataCompetencia: "2026-09-18",
  codigoIbgeEmissao: "2919553",
  prestador: { cnpj: "62060013000103", email: "financeiro@exemplo.com.br", opSimplesNacional: "3", regimeApuracaoSN: "1", regimeEspecial: "0" },
  tomador: { documento: "11222333000181", nome: "Tomador de Teste & Cia Ltda", email: "contato@tomador.com.br" },
  servico: { codigoIbgePrestacao: "2919553", codigoTributacaoNacional: "170202", descricao: "Apoio administrativo referente a setembro/2026 <teste>" },
  valores: { servicoCentavos: 150000, issRetido: false, percentualTributosSN: 6 },
});

function certificadoDeTeste() {
  const chaves = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: "commonName", value: "EMPRESA TESTE:62060013000103" }]);
  cert.setIssuer([{ name: "commonName", value: "EMPRESA TESTE:62060013000103" }]);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  return { chavePem: forge.pki.privateKeyToPem(chaves.privateKey), certificadoPem: forge.pki.certificateToPem(cert) };
}

test("Id da DPS: DPS + município(7) + tipo(1) + CNPJ(14) + série(5) + número(15) = 45 posições", () => {
  const id = idDps({ codigoIbgeEmissao: "2919553", serie: "1", numero: 42, documentoPrestador: "62.060.013/0001-03" });
  assert.equal(id, "DPS" + "2919553" + "2" + "62060013000103" + "00001" + "000000000000042");
  assert.equal(id.length, 45);
  assert.match(id, /^DPS[0-9]{42}$/);
});

test("dhEmi no fuso de Brasília e com 1 minuto de margem (regra E0008)", () => {
  assert.equal(dataHoraBrasilia(new Date("2026-09-18T15:00:00Z")), "2026-09-18T12:00:00-03:00");
  const { xml } = montarDps(base());
  assert.match(xml, /<dhEmi>2026-09-18T11:59:00-03:00<\/dhEmi>/);
});

test("DPS do piloto (ME/EPP) segue o XSD oficial v1.01 e as regras do Anexo I", (t) => {
  const { xml, id } = montarDps(base());
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">'));
  assert.match(xml, new RegExp(`<infDPS Id="${id}">`));
  assert.match(xml, /<regApTribSN>1<\/regApTribSN>/);
  assert.match(xml, /<totTrib><pTotTribSN>6\.00<\/pTotTribSN><\/totTrib>/, "ME/EPP informa pTotTribSN (E0712)");
  assert.doesNotMatch(xml, /indTotTrib/);
  assert.doesNotMatch(xml, /pAliq/, "município no Sistema Nacional: alíquota vem parametrizada");
  assert.match(xml, /Tomador de Teste &amp; Cia Ltda/);
  assert.match(xml, /&lt;teste&gt;/);
  const r = validarXsd(xml, "dps-sem-assinatura");
  if (r.pulado) return t.skip("Python/lxml indisponível");
  assert.ok(r.ok, r.saida);
});

test("DPS assinada: sem prefixo de namespace (E1228), assinatura após infDPS, válida e ainda aderente ao XSD", (t) => {
  const { xml, id } = montarDps(base());
  const cert = certificadoDeTeste();
  const assinado = assinarDps(xml, cert.chavePem, cert.certificadoPem);
  assert.doesNotMatch(assinado, /<\w+:\w+/, "nenhum elemento com prefixo");
  assert.match(assinado, /<\/infDPS><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/);
  assert.match(assinado, new RegExp(`<Reference URI="#${id}">`));
  assert.match(assinado, /rsa-sha1/);
  assert.match(assinado, /<X509Certificate>[A-Za-z0-9+/=]+<\/X509Certificate>/);
  assert.ok(assinaturaValida(assinado, cert.certificadoPem));
  assert.equal(assinaturaValida(assinado.replace("<vServ>1500.00</vServ>", "<vServ>1600.00</vServ>"), cert.certificadoPem), false, "alterar o XML invalida a assinatura (E0714)");
  const r = validarXsd(assinado, "dps-assinada");
  if (r.pulado) return t.skip("Python/lxml indisponível");
  assert.ok(r.ok, r.saida);
});

test("valida entradas antes de montar: E0712, competência futura, códigos", () => {
  assert.throws(() => montarDps({ ...base(), valores: { ...base().valores, percentualTributosSN: null } }), /E0712/);
  assert.throws(() => montarDps({ ...base(), dataCompetencia: "2026-10-01" }), /E0015/);
  assert.throws(() => montarDps({ ...base(), servico: { ...base().servico, codigoTributacaoNacional: "17.02" } }), /6 dígitos/);
  // Não optante: usa indTotTrib e não informa regApTribSN (E0162).
  const { xml } = montarDps({ ...base(), prestador: { ...base().prestador, opSimplesNacional: "1", regimeApuracaoSN: null }, valores: { ...base().valores, percentualTributosSN: null } });
  assert.match(xml, /<indTotTrib>0<\/indTotTrib>/);
  assert.doesNotMatch(xml, /regApTribSN/);
});
