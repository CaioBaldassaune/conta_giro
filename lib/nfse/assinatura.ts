// Assinatura XMLDSig da DPS (padrão do Sistema Nacional NFS-e):
// - assinatura envelopada, inserida logo após <infDPS>, referenciando "#<Id da DPS>"
// - C14N inclusiva, RSA-SHA1 e digest SHA1 (relatos de emissões aceitas pela Sefin Nacional)
// - SEM prefixo de namespace (<Signature xmlns="...">), senão a Sefin rejeita (E1228)
// - o XML não pode ser alterado depois de assinado (E0714)

import { SignedXml } from "xml-crypto";

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
export const ALGORITMOS = {
  assinatura: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
  digest: "http://www.w3.org/2000/09/xmldsig#sha1",
};

const corpoDoCertificado = (pem: string) => pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");

export function assinarDps(xml: string, chavePem: string, certificadoPem: string): string {
  const assinatura = new SignedXml({
    privateKey: chavePem,
    publicCert: certificadoPem,
    signatureAlgorithm: ALGORITMOS.assinatura,
    canonicalizationAlgorithm: C14N,
    getKeyInfoContent: () => `<X509Data><X509Certificate>${corpoDoCertificado(certificadoPem)}</X509Certificate></X509Data>`,
  });
  assinatura.addReference({
    xpath: "//*[local-name(.)='infDPS']",
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: ALGORITMOS.digest,
  });
  assinatura.computeSignature(xml, { location: { reference: "//*[local-name(.)='infDPS']", action: "after" } });
  return assinatura.getSignedXml();
}

/** Confere a assinatura (usado nos testes e antes do envio). */
export function assinaturaValida(xmlAssinado: string, certificadoPem: string): boolean {
  const verificador = new SignedXml({ publicCert: certificadoPem });
  const inicio = xmlAssinado.indexOf("<Signature");
  const fim = xmlAssinado.indexOf("</Signature>") + "</Signature>".length;
  if (inicio < 0 || fim < inicio) return false;
  verificador.loadSignature(xmlAssinado.slice(inicio, fim));
  try {
    return verificador.checkSignature(xmlAssinado);
  } catch {
    return false;
  }
}
