import assert from "node:assert/strict";
import test from "node:test";
import forge from "node-forge";
import { exigirValido, lerCertificado } from "../.domain-tests/certificado.mjs";
import { etiquetaRequisicao, montarCorpo } from "../.domain-tests/serpro-formato.mjs";

// Gera um A1 de teste no padrão ICP-Brasil: CN "NOME:CNPJ" e CNPJ no otherName 2.16.76.1.3.3,
// empacotado com 3DES (cifra antiga comum nos certificados brasileiros).
function pfxDeTeste({ cnpj = "12345678000195", senha = "segredo", validoAte = new Date(Date.now() + 86_400_000 * 30) } = {}) {
  const chaves = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = validoAte;
  const nome = [{ name: "commonName", value: `ESCRITORIO TESTE LTDA:${cnpj}` }];
  cert.setSubject(nome);
  cert.setIssuer(nome);
  const otherName = forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, forge.asn1.oidToDer("2.16.76.1.3.3").getBytes()),
    forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, cnpj),
    ]),
  ]);
  cert.setExtensions([{ name: "subjectAltName", altNames: [], value: forge.asn1.toDer(forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [otherName])).getBytes() }]);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert], senha, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}

test("lê o A1: CNPJ do otherName ICP-Brasil, titular e chave/certificado em PEM", () => {
  const c = lerCertificado(pfxDeTeste(), "segredo");
  assert.equal(c.cnpj, "12345678000195");
  assert.equal(c.titular, "ESCRITORIO TESTE LTDA");
  assert.match(c.chavePem, /BEGIN RSA PRIVATE KEY/);
  assert.match(c.certificadoPem, /BEGIN CERTIFICATE/);
  exigirValido(c);
});

test("senha errada e certificado vencido são recusados com mensagem clara", () => {
  assert.throws(() => lerCertificado(pfxDeTeste(), "errada"), /Confira o arquivo .pfx e a senha/);
  const vencido = lerCertificado(pfxDeTeste({ validoAte: new Date(Date.now() - 1000) }), "segredo");
  assert.throws(() => exigirValido(vencido), /vencido/);
});

test("corpo do Integra Contador: escritório como contratante e autor; dados como JSON escapado", () => {
  const corpo = montarCorpo("11222333000181", { tipo: "Consultar", idSistema: "PGDASD", idServico: "CONSULTIMADECREC14", contribuinte: "99888777000166", dados: { periodoApuracao: "202608" } });
  assert.deepEqual(corpo.contratante, { numero: "11222333000181", tipo: 2 });
  assert.deepEqual(corpo.autorPedidoDados, corpo.contratante);
  assert.deepEqual(corpo.contribuinte, { numero: "99888777000166", tipo: 2 });
  assert.equal(corpo.pedidoDados.versaoSistema, "1.0");
  assert.equal(corpo.pedidoDados.dados, "{\"periodoApuracao\":\"202608\"}");
  const vazio = montarCorpo("11222333000181", { tipo: "Monitorar", idSistema: "CAIXAPOSTAL", idServico: "INNOVAMSG63", contribuinte: "12345678901", dados: "" });
  assert.equal(vazio.pedidoDados.dados, "");
  assert.deepEqual(vazio.contribuinte, { numero: "12345678901", tipo: 1 });
});

test("X-Request-Tag segue o formato sugerido (tipo+autor+tipo+contribuinte) em até 32 caracteres", () => {
  const tag = etiquetaRequisicao("11222333000181", "99888777000166");
  assert.equal(tag, "2" + "11222333000181" + "2" + "99888777000166");
  assert.ok(tag.length <= 32);
  assert.ok(etiquetaRequisicao("11222333000181", "12345678901").startsWith("2112223330001811"));
});
