// Cliente SOAP do WebISS (ABRASF 2.02): envia o GerarNfse com o certificado A1 da empresa (mTLS).

import "server-only";
import https from "node:https";
import type { Certificado } from "../certificado";
import { ACAO_GERAR, envelopeGerar, lerRespostaGerar, urlWebiss, type RespostaGerar } from "./abrasf";
import type { AmbienteNfse } from "./dps";

function postarSoap(url: string, acao: string, envelope: string, certificado: Certificado): Promise<{ status: number; corpo: string }> {
  const corpo = Buffer.from(envelope, "utf8");
  return new Promise((resolver, rejeitar) => {
    const req = https.request(url, {
      method: "POST",
      key: certificado.chavePem,
      cert: certificado.certificadoPem,
      timeout: 60_000,
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${acao}"`, "Content-Length": corpo.length },
    }, (res) => {
      const partes: Buffer[] = [];
      res.on("data", (p) => partes.push(p));
      res.on("end", () => resolver({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("Tempo esgotado na comunicação com o WebISS. Consulte a nota no portal antes de tentar de novo.")));
    req.on("error", rejeitar);
    req.end(corpo);
  });
}

/** Emite a NFS-e a partir do RPS assinado. Devolve o retorno lido e o corpo bruto (para auditoria). */
export async function gerarNfseWebiss(municipio: string, ambiente: AmbienteNfse, certificado: Certificado, rpsAssinado: string): Promise<RespostaGerar & { http: number; bruto: string }> {
  const res = await postarSoap(urlWebiss(municipio, ambiente), ACAO_GERAR, envelopeGerar(rpsAssinado), certificado);
  const lido = res.corpo.trim()
    ? lerRespostaGerar(res.corpo)
    : { ok: false as const, erros: [{ codigo: `HTTP ${res.status}`, mensagem: "O WebISS não devolveu conteúdo." }] };
  return { ...lido, http: res.status, bruto: res.corpo.slice(0, 20000) };
}
