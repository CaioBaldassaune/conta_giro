// Leitura de certificados digitais ICP-Brasil (A1, arquivo .pfx/.p12).
// Usa node-forge porque muitos A1 brasileiros usam cifras antigas (RC2/3DES)
// que o OpenSSL 3 do Node não abre sem o modo "legacy".

import forge from "node-forge";
import { DomainError } from "./domain";

export type Certificado = {
  cnpj: string | null;
  cpf: string | null;
  titular: string;
  validoDe: Date;
  validoAte: Date;
  chavePem: string;
  certificadoPem: string;
};

// OIDs ICP-Brasil gravados no SubjectAltName (otherName).
const OID_CNPJ = "2.16.76.1.3.3";
const OID_PF = "2.16.76.1.3.1"; // data de nascimento (8) + CPF (11) + ...

function valoresOtherName(cert: forge.pki.Certificate): Map<string, string> {
  const valores = new Map<string, string>();
  const ext = cert.getExtension("subjectAltName") as { value?: string } | null;
  if (!ext?.value) return valores;
  try {
    const asn1 = forge.asn1.fromDer(ext.value);
    for (const nome of asn1.value as forge.asn1.Asn1[]) {
      if (nome.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || nome.type !== 0) continue; // otherName
      const [oid, conteudo] = nome.value as forge.asn1.Asn1[];
      const id = forge.asn1.derToOid(oid.value as string);
      let bruto: forge.asn1.Asn1 = conteudo;
      while (Array.isArray(bruto.value) && bruto.value.length) bruto = bruto.value[0] as forge.asn1.Asn1;
      valores.set(id, String(bruto.value));
    }
  } catch {
    // Extensão fora do padrão: seguimos com o CN.
  }
  return valores;
}

/** Abre o .pfx com a senha e devolve dados do titular e chave/certificado em PEM. */
export function lerCertificado(pfx: Uint8Array, senha: string): Certificado {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const der = forge.util.createBuffer(Buffer.from(pfx).toString("binary"));
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, senha);
  } catch {
    throw new DomainError("Não foi possível abrir o certificado. Confira o arquivo .pfx e a senha.", 422);
  }
  const chaves = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const chaveBag = chaves[0] ?? (p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [])[0];
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((b) => b.cert!).filter(Boolean);
  if (!chaveBag?.key || !certs.length) throw new DomainError("O arquivo não contém chave privada e certificado.", 422);

  // O certificado do titular é o que corresponde à chave privada (os demais são da cadeia).
  const chave = chaveBag.key as forge.pki.rsa.PrivateKey;
  const cert = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n.equals(chave.n)) ?? certs[0];

  const outros = valoresOtherName(cert);
  const cn = String(cert.subject.getField("CN")?.value ?? "");
  const cnpj = (outros.get(OID_CNPJ) ?? "").replace(/\D/g, "").slice(0, 14) || cn.match(/:(\d{14})$/)?.[1] || null;
  const dadosPf = (outros.get(OID_PF) ?? "").replace(/\D/g, "");
  const cpf = dadosPf.length >= 19 ? dadosPf.slice(8, 19) : cn.match(/:(\d{11})$/)?.[1] ?? null;

  return {
    cnpj: cnpj && cnpj.length === 14 ? cnpj : null,
    cpf,
    titular: cn.replace(/:\d{11,14}$/, "") || "Titular não identificado",
    validoDe: cert.validity.notBefore,
    validoAte: cert.validity.notAfter,
    chavePem: forge.pki.privateKeyToPem(chave),
    certificadoPem: forge.pki.certificateToPem(cert),
  };
}

/** Garante que o certificado está dentro da validade. */
export function exigirValido(c: Certificado, agora = new Date()) {
  if (c.validoAte < agora) throw new DomainError(`Certificado vencido em ${c.validoAte.toLocaleDateString("pt-BR")}.`, 422);
  if (c.validoDe > agora) throw new DomainError("Certificado ainda não está válido.", 422);
}
