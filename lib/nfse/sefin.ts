// Cliente da Sefin Nacional (API REST do Sistema Nacional NFS-e).
//   POST {base}/nfse  { dpsXmlGZipB64 }  → 201 { chaveAcesso, idDps, nfseXmlGZipB64, alertas }
//   GET  {base}/nfse/{chaveAcesso}       → NFS-e autorizada
//   DANFSe (PDF): {adn}/danfse/{chaveAcesso}
// Toda chamada usa o certificado A1 da empresa emitente (mTLS), que precisa ser
// ICP-Brasil e trazer o CNPJ (regras E1200–E1209 da recepção).

import "server-only";
import https from "node:https";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Certificado } from "../certificado";
import type { AmbienteNfse } from "./dps";

const BASES: Record<AmbienteNfse, { sefin: string; adn: string }> = {
  producao_restrita: { sefin: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional", adn: "https://adn.producaorestrita.nfse.gov.br" },
  producao: { sefin: "https://sefin.nfse.gov.br/SefinNacional", adn: "https://adn.nfse.gov.br" },
};

type Resposta = { status: number; corpo: Buffer; tipo: string };

function requisicao(url: string, certificado: Certificado, opcoes: { metodo: "GET" | "POST"; json?: unknown }): Promise<Resposta> {
  const corpo = opcoes.json === undefined ? undefined : Buffer.from(JSON.stringify(opcoes.json), "utf8");
  return new Promise((resolver, rejeitar) => {
    const req = https.request(url, {
      method: opcoes.metodo,
      key: certificado.chavePem,
      cert: certificado.certificadoPem,
      timeout: 60_000,
      headers: corpo ? { "Content-Type": "application/json", Accept: "application/json", "Content-Length": corpo.length } : { Accept: "*/*" },
    }, (res) => {
      const partes: Buffer[] = [];
      res.on("data", (p) => partes.push(p));
      res.on("end", () => resolver({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes), tipo: String(res.headers["content-type"] ?? "") }));
    });
    req.on("timeout", () => req.destroy(new Error("Tempo esgotado na comunicação com a Sefin Nacional.")));
    req.on("error", rejeitar);
    req.end(corpo);
  });
}

export type MensagemSefin = { codigo: string; descricao: string; complemento?: string };
export type ResultadoEmissao =
  | { ok: true; chaveAcesso: string; idDps: string; nfseXml: string; numeroNfse: string | null; alertas: MensagemSefin[]; bruto: unknown }
  | { ok: false; status: number; erros: MensagemSefin[]; bruto: unknown };

// A API devolve as mensagens com a primeira letra maiúscula ou minúscula, conforme a versão.
function mensagens(lista: unknown): MensagemSefin[] {
  if (!Array.isArray(lista)) return [];
  return lista.map((m: Record<string, unknown>) => ({
    codigo: String(m.Codigo ?? m.codigo ?? ""),
    descricao: String(m.Descricao ?? m.descricao ?? m.mensagem ?? ""),
    complemento: m.Complemento ?? m.complemento ? String(m.Complemento ?? m.complemento) : undefined,
  }));
}

export const compactarXml = (xml: string) => gzipSync(Buffer.from(xml, "utf8")).toString("base64");
export const descompactarXml = (b64: string) => gunzipSync(Buffer.from(b64, "base64")).toString("utf8");

export async function emitirDps(ambiente: AmbienteNfse, certificado: Certificado, dpsAssinada: string): Promise<ResultadoEmissao> {
  const res = await requisicao(`${BASES[ambiente].sefin}/nfse`, certificado, { metodo: "POST", json: { dpsXmlGZipB64: compactarXml(dpsAssinada) } });
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(res.corpo.toString("utf8")); } catch { /* corpo não JSON */ }

  if (res.status === 495 || res.status === 496) {
    return { ok: false, status: res.status, erros: [{ codigo: "CERTIFICADO", descricao: "A Sefin Nacional não aceitou o certificado da empresa (precisa ser e-CNPJ ICP-Brasil válido)." }], bruto: json };
  }
  if ((res.status === 200 || res.status === 201) && typeof json.nfseXmlGZipB64 === "string" && json.chaveAcesso) {
    const nfseXml = descompactarXml(json.nfseXmlGZipB64);
    return {
      ok: true,
      chaveAcesso: String(json.chaveAcesso),
      idDps: String(json.idDps ?? ""),
      nfseXml,
      numeroNfse: nfseXml.match(/<nNFSe>(\d+)<\/nNFSe>/)?.[1] ?? null,
      alertas: mensagens(json.alertas),
      bruto: { ...json, nfseXmlGZipB64: undefined },
    };
  }
  const erros = mensagens(json.erros ?? json.Erros ?? json.mensagens);
  return { ok: false, status: res.status, erros: erros.length ? erros : [{ codigo: `HTTP ${res.status}`, descricao: res.corpo.toString("utf8").slice(0, 500) || "Resposta sem conteúdo." }], bruto: json };
}

/** PDF da DANFSe. Melhor esforço: se falhar, a nota continua válida pelo XML. */
export async function baixarDanfse(ambiente: AmbienteNfse, certificado: Certificado, chaveAcesso: string): Promise<Buffer | null> {
  try {
    const res = await requisicao(`${BASES[ambiente].adn}/danfse/${chaveAcesso}`, certificado, { metodo: "GET" });
    return res.status === 200 && res.corpo.subarray(0, 5).toString() === "%PDF-" ? res.corpo : null;
  } catch {
    return null;
  }
}
