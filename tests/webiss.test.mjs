import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import forge from "node-forge";
import { envelopeGerar, idRps, lerRespostaGerar, linkNfseWebiss, montarRps, urlWebiss } from "../.domain-tests/nfse/abrasf.mjs";
import { assinarElemento, assinaturaValida } from "../.domain-tests/nfse/assinatura.mjs";

const XSD = path.resolve("docs/nfse/webiss/2.02/nfse.xsd");
const pasta = mkdtempSync(path.join(tmpdir(), "webiss-"));

// Valida contra o XSD do WebISS 2.02 com lxml (Python). Sem Python/lxml, o teste é pulado.
function validarXsd(xml, nome) {
  const arquivo = path.join(pasta, `${nome}.xml`);
  writeFileSync(arquivo, xml, "utf8");
  const r = spawnSync("python", ["scripts/validar-xsd.py", XSD, arquivo], { encoding: "utf8" });
  if (r.error || /No module named/.test(r.stderr)) return { pulado: true };
  return { ok: r.status === 0, saida: (r.stdout + r.stderr).trim() };
}

function certificadoDeTeste() {
  const chaves = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: "commonName", value: "BI2B TESTE:63172986000105" }]);
  cert.setIssuer([{ name: "commonName", value: "BI2B TESTE:63172986000105" }]);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  return { chavePem: forge.pki.privateKeyToPem(chaves.privateKey), certificadoPem: forge.pki.certificateToPem(cert) };
}

// Cenário do segundo cliente de teste: BI2B (ME no Simples, Palmas/TO, WebISS).
const base = () => ({
  serie: "1",
  numero: 7,
  dataEmissao: "2026-09-19",
  competencia: "2026-09-15",
  prestador: { cnpj: "63172986000105", inscricaoMunicipal: "2482201", optanteSimples: true },
  tomador: {
    documento: "62.060.013/0001-03", nome: "Tomador & Filhos <Ltda>", email: "contato@tomador.com.br", telefone: "(63) 99999-0000",
    endereco: { logradouro: "Quadra ACSO 11 Rua SO 9", numero: "17", complemento: "Conj 02 Lote 26", bairro: "Plano Diretor Sul", codigoIbge: "1721000", uf: "TO", cep: "77015-032" },
  },
  servico: { valorCentavos: 250050, issRetido: false, itemListaServico: "17.19", cnae: "6920-6/01", codigoTributacaoMunicipio: "171901", discriminacao: "Serviços contábeis de setembro/2026", codigoIbge: "1721000" },
});

test("RPS ABRASF 2.02: estrutura, escapes e campos do Simples", () => {
  const { xml, id } = montarRps(base());
  assert.equal(id, "rps17");
  assert.equal(idRps("00001", 42), "rps0000142");
  assert.match(xml, /^<GerarNfseEnvio xmlns="http:\/\/www\.abrasf\.org\.br\/nfse\.xsd"><Rps><InfDeclaracaoPrestacaoServico Id="rps17">/);
  assert.match(xml, /<ValorServicos>2500\.50<\/ValorServicos>/);
  assert.match(xml, /<IssRetido>2<\/IssRetido><ItemListaServico>17\.19<\/ItemListaServico><CodigoCnae>6920601<\/CodigoCnae>/);
  assert.match(xml, /<Cnpj>62060013000103<\/Cnpj>/);
  assert.match(xml, /Tomador &amp; Filhos &lt;Ltda&gt;/);
  assert.match(xml, /<Cep>77015032<\/Cep>/);
  assert.match(xml, /<OptanteSimplesNacional>1<\/OptanteSimplesNacional><IncentivoFiscal>2<\/IncentivoFiscal>/);
  assert.doesNotMatch(xml, /ResponsavelRetencao/);
  const retido = montarRps({ ...base(), servico: { ...base().servico, issRetido: true } }).xml;
  assert.match(retido, /<IssRetido>1<\/IssRetido><ResponsavelRetencao>1<\/ResponsavelRetencao>/);
});

test("RPS exige IM do prestador, código municipal e endereço completo do tomador", () => {
  assert.throws(() => montarRps({ ...base(), prestador: { ...base().prestador, inscricaoMunicipal: "" } }), /inscrição municipal/);
  assert.throws(() => montarRps({ ...base(), servico: { ...base().servico, codigoTributacaoMunicipio: "" } }), /tributação municipal/);
  assert.throws(() => montarRps({ ...base(), servico: { ...base().servico, itemListaServico: "1719" } }), /00\.00/);
  assert.throws(() => montarRps({ ...base(), tomador: { ...base().tomador, endereco: { ...base().tomador.endereco, bairro: "" } } }), /bairro/);
  assert.throws(() => montarRps({ ...base(), competencia: "2026-09-20" }), /posterior/);
  assert.doesNotThrow(() => montarRps({ ...base(), tomador: null }));
});

test("RPS assinado em InfDeclaracaoPrestacaoServico é válido no XSD do WebISS e na assinatura", () => {
  const cert = certificadoDeTeste();
  const { xml } = montarRps(base());
  const assinado = assinarElemento(xml, "InfDeclaracaoPrestacaoServico", cert.chavePem, cert.certificadoPem);
  assert.match(assinado, /<\/InfDeclaracaoPrestacaoServico><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/);
  assert.match(assinado, /<Reference URI="#rps17">/);
  assert.equal(assinaturaValida(assinado, cert.certificadoPem), true);
  const r = validarXsd(assinado, "rps");
  if (!r.pulado) assert.equal(r.ok, true, r.saida);
  const semTomador = assinarElemento(montarRps({ ...base(), tomador: null }).xml, "InfDeclaracaoPrestacaoServico", cert.chavePem, cert.certificadoPem);
  const r2 = validarXsd(semTomador, "rps-sem-tomador");
  if (!r2.pulado) assert.equal(r2.ok, true, r2.saida);
});

test("envelope SOAP leva cabeçalho e dados escapados, com a declaração XML", () => {
  const env = envelopeGerar("<GerarNfseEnvio/>");
  assert.match(env, /<GerarNfseRequest xmlns="http:\/\/nfse\.abrasf\.org\.br">/);
  assert.match(env, /<nfseCabecMsg xmlns="">&lt;\?xml version=&quot;1\.0&quot; encoding=&quot;UTF-8&quot;\?&gt;&lt;cabecalho /);
  assert.match(env, /<nfseDadosMsg xmlns="">&lt;\?xml version=&quot;1\.0&quot; encoding=&quot;UTF-8&quot;\?&gt;&lt;GerarNfseEnvio\/&gt;<\/nfseDadosMsg>/);
  assert.equal(urlWebiss("palmasto", "producao"), "https://palmasto.webiss.com.br/ws/nfse.asmx");
  assert.equal(urlWebiss("palmasto", "producao_restrita"), "https://homologacao.webiss.com.br/ws/nfse.asmx");
  assert.equal(linkNfseWebiss("palmasto", "producao", "63172986000105", "AB12CD", "15"), "https://palmasto.webiss.com.br/externo/nfse/visualizar/63172986000105/AB12CD/15");
});

const soap = (saida) => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GerarNfseResponse xmlns="http://nfse.abrasf.org.br"><outputXML>${saida.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</outputXML></GerarNfseResponse></soap:Body></soap:Envelope>`;

test("resposta com nota: número, código de verificação e CompNfse", () => {
  const saida = `<?xml version="1.0" encoding="utf-8"?><GerarNfseResposta xmlns="http://www.abrasf.org.br/nfse.xsd"><ListaNfse><CompNfse><Nfse versao="2.02"><InfNfse Id="nfse15"><Numero>15</Numero><CodigoVerificacao>AB12CD</CodigoVerificacao><DataEmissao>2026-09-19T10:00:00</DataEmissao><DeclaracaoPrestacaoServico><InfDeclaracaoPrestacaoServico><Rps><IdentificacaoRps><Numero>7</Numero></IdentificacaoRps></Rps></InfDeclaracaoPrestacaoServico></DeclaracaoPrestacaoServico></InfNfse></Nfse></CompNfse><ListaMensagemAlertaRetorno><MensagemRetorno><Codigo>A1</Codigo><Mensagem>Alerta &amp; teste</Mensagem></MensagemRetorno></ListaMensagemAlertaRetorno></ListaNfse></GerarNfseResposta>`;
  const r = lerRespostaGerar(soap(saida));
  assert.equal(r.ok, true);
  assert.equal(r.numero, "15");
  assert.equal(r.codigoVerificacao, "AB12CD");
  assert.equal(r.dataEmissao, "2026-09-19T10:00:00");
  assert.match(r.compNfse, /^<CompNfse xmlns="http:\/\/www\.abrasf\.org\.br\/nfse\.xsd"><Nfse/);
  assert.deepEqual(r.alertas, [{ codigo: "A1", mensagem: "Alerta & teste", correcao: undefined }]);
});

test("resposta com erro e falha SOAP viram mensagens legíveis", () => {
  const erro = `<GerarNfseResposta xmlns="http://www.abrasf.org.br/nfse.xsd"><ListaMensagemRetorno><MensagemRetorno><Codigo>E160</Codigo><Mensagem>Código de tributação inválido</Mensagem><Correcao>Informe o código do município</Correcao></MensagemRetorno></ListaMensagemRetorno></GerarNfseResposta>`;
  assert.deepEqual(lerRespostaGerar(soap(erro)), { ok: false, erros: [{ codigo: "E160", mensagem: "Código de tributação inválido", correcao: "Informe o código do município" }] });
  const falha = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>Certificado não autorizado</faultstring></soap:Fault></soap:Body></soap:Envelope>`;
  assert.deepEqual(lerRespostaGerar(falha), { ok: false, erros: [{ codigo: "SOAP", mensagem: "Certificado não autorizado" }] });
});
