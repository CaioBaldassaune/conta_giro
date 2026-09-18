// Orquestração da emissão de NFS-e a partir de um rascunho de nota do ContaGiro:
// reserva o número da DPS → monta → valida → assina → envia à Sefin Nacional →
// arquiva XML (e DANFSe) em Documentos → marca a nota como autorizada.

import "server-only";
import { DomainError, requireThat, type Entry } from "../domain";
import { exigirValido, lerCertificado, type Certificado } from "../certificado";
import { caminhoDocumento, enviarArquivo, sha256 } from "../arquivos";
import { comRetentativa, context, persist, type Contexto } from "../server";
import type { ClienteAdmin } from "../supabase/admin";
import { assinarDps, assinaturaValida } from "./assinatura";
import { ErroDps, montarDps, type AmbienteNfse } from "./dps";
import { baixarDanfse, emitirDps } from "./sefin";

export async function certificadoDaEmpresa(admin: ClienteAdmin, empresaId: string): Promise<Certificado> {
  const { data: registro } = await admin.from("certificados_digitais").select("*").eq("empresa_id", empresaId).eq("situacao", "ativo").maybeSingle();
  requireThat(registro, "Envie o certificado A1 da empresa em Integrações → NFS-e antes de emitir.", 409);
  const ler = async (id: string) => {
    const { data, error } = await admin.rpc("cofre_ler", { p_id: id });
    if (error || typeof data !== "string") throw new DomainError("Não foi possível ler o certificado no cofre.", 500);
    return data;
  };
  const [pfx, senha] = await Promise.all([ler(registro.arquivo_segredo_id), ler(registro.senha_segredo_id)]);
  const certificado = lerCertificado(Buffer.from(pfx, "base64"), senha);
  exigirValido(certificado);
  return certificado;
}

export async function emitirNota(admin: ClienteAdmin, empresaId: string, notaId: string) {
  const ctx = await context(empresaId);
  requireThat(["accountant", "owner", "finance", "issuer"].includes(ctx.role), "Seu perfil não pode emitir notas.", 403);
  const nota = ctx.records.find((r) => r.id === notaId && r.kind === "invoice");
  requireThat(nota, "Nota não encontrada.", 404);
  const d = nota.data;
  requireThat(d.status === "draft", "Somente rascunhos podem ser emitidos.");
  requireThat(d.issStatus !== "pending_review", "Aguarde a conferência de ISS pelo contador antes de emitir.");
  requireThat(!d.taxVersion || d.taxVersion === ctx.company.data.tax.version, "A matriz tributária mudou. Cancele o rascunho e prepare outro.");
  const atividade = d.activitySnapshot ?? ctx.company.data.tax.activities?.find((a) => a.id === d.activityId);
  requireThat(atividade?.nationalCode, "O rascunho precisa de uma atividade com código de tributação nacional.");
  requireThat(ctx.company.data.cnpj, "Cadastre o CNPJ da empresa.");

  const { data: config } = await ctx.sb.from("configuracoes_nfse").select("*").eq("empresa_id", empresaId).maybeSingle();
  requireThat(config?.ativa, "Configure e ative a emissão de NFS-e desta empresa em Integrações → NFS-e.", 409);
  const certificado = await certificadoDaEmpresa(admin, empresaId);
  requireThat(certificado.cnpj === ctx.company.data.cnpj, "O certificado enviado não é do CNPJ desta empresa.", 409);

  // Reserva atômica do número (a função confere o papel do usuário).
  const { data: reserva, error: erroReserva } = await ctx.sb.rpc("reservar_numero_dps", { p_empresa: empresaId });
  if (erroReserva || !reserva?.[0]) throw new DomainError(erroReserva?.message ?? "Não foi possível reservar o número da DPS.", 409);
  const { r_serie: serie, r_numero: numero, r_ambiente: ambiente } = reserva[0] as { r_serie: string; r_numero: number; r_ambiente: AmbienteNfse };
  const devolverNumero = () => admin.from("configuracoes_nfse").update({ proximo_numero_dps: numero }).eq("empresa_id", empresaId).eq("proximo_numero_dps", numero + 1);

  const tomador = d.contactSnapshot?.taxId
    ? { documento: d.contactSnapshot.taxId, nome: d.customer, email: d.contactSnapshot.email || null, inscricaoMunicipal: d.contactSnapshot.municipalRegistration || null }
    : null;
  let dps: { xml: string; id: string };
  try {
    dps = montarDps({
      ambiente,
      emitidaEm: new Date(),
      serie,
      numero: Number(numero),
      dataCompetencia: d.serviceDate ?? new Date().toISOString().slice(0, 10),
      codigoIbgeEmissao: config.codigo_ibge_emissao,
      prestador: {
        cnpj: ctx.company.data.cnpj,
        inscricaoMunicipal: config.inscricao_municipal,
        email: ctx.company.data.email || null,
        telefone: ctx.company.data.phone || null,
        opSimplesNacional: config.op_simples_nacional,
        regimeApuracaoSN: config.regime_apuracao_sn,
        regimeEspecial: config.regime_especial,
      },
      tomador,
      servico: {
        // Local da prestação: o município do emissor (prestação local). Outros municípios exigirão o código IBGE do local.
        codigoIbgePrestacao: config.codigo_ibge_emissao,
        codigoTributacaoNacional: String(atividade.nationalCode).replace(/\D/g, ""),
        codigoTributacaoMunicipal: atividade.municipalRequired && /^\d{3}$/.test(atividade.municipalCode ?? "") ? atividade.municipalCode : null,
        descricao: d.service,
        nbs: atividade.nbsRequired ? atividade.nbs : null,
      },
      valores: {
        servicoCentavos: d.amount,
        issRetido: !!d.issRetained,
        percentualTributosSN: config.percentual_tributos_sn != null ? Number(config.percentual_tributos_sn) : null,
      },
    });
  } catch (e) {
    await devolverNumero();
    throw e instanceof ErroDps ? new DomainError(e.message, 422) : e;
  }

  const assinada = assinarDps(dps.xml, certificado.chavePem, certificado.certificadoPem);
  requireThat(assinaturaValida(assinada, certificado.certificadoPem), "Falha interna ao assinar a DPS.", 500);

  const resultado = await emitirDps(ambiente, certificado, assinada);
  await admin.from("notas_fiscais").update({ serie_dps: serie, numero_dps: numero, id_dps: dps.id, ambiente, retorno_emissao: resultado.bruto }).eq("id", notaId);
  if (!resultado.ok) {
    await devolverNumero();
    // Libera o número para a próxima tentativa (a DPS rejeitada não gera nota).
    await admin.from("notas_fiscais").update({ serie_dps: null, numero_dps: null }).eq("id", notaId);
    const texto = resultado.erros.map((e) => `${e.codigo}: ${e.descricao}${e.complemento ? ` (${e.complemento})` : ""}`).join(" • ");
    throw new DomainError(`A Sefin Nacional rejeitou a DPS. ${texto}`, 422);
  }

  // Arquiva XML e DANFSe e marca a nota como autorizada.
  const xmlBytes = Buffer.from(resultado.nfseXml, "utf8");
  const xmlId = crypto.randomUUID();
  const xmlCaminho = caminhoDocumento(ctx.escritorioId, empresaId, xmlId);
  await enviarArquivo(ctx.sb, xmlCaminho, xmlBytes, "application/xml");
  const pdf = await baixarDanfse(ambiente, certificado, resultado.chaveAcesso);
  const pdfId = pdf ? crypto.randomUUID() : null;
  const pdfCaminho = pdfId ? caminhoDocumento(ctx.escritorioId, empresaId, pdfId) : null;
  if (pdf && pdfCaminho) await enviarArquivo(ctx.sb, pdfCaminho, pdf, "application/pdf");
  const numeroNfse = resultado.numeroNfse ?? resultado.chaveAcesso.slice(-15);
  const [hashXml, hashPdf] = await Promise.all([sha256(xmlBytes), pdf ? sha256(pdf) : Promise.resolve(null)]);

  await comRetentativa(async () => {
    const atual: Contexto = await context(empresaId);
    const agora = new Date().toISOString();
    const notaAtual = atual.records.find((r) => r.id === notaId)!;
    const doc = (id: string, nome: string, caminho: string, tamanho: number, mime: string, hash: string): Entry => ({
      id, kind: "document", period: notaAtual.period,
      data: { name: nome, category: "invoice", key: caminho, size: tamanho, mime, sha256: hash, version: 1, uploadedAt: agora, uploadedBy: atual.u.email, acknowledgments: [], scope: "monthly" },
    });
    const entradas: Entry[] = [
      { ...notaAtual, data: { ...notaAtual.data, status: "authorized", number: numeroNfse, issuedAt: agora } },
      doc(xmlId, `NFS-e_${numeroNfse}_${resultado.chaveAcesso}.xml`, xmlCaminho, xmlBytes.byteLength, "application/xml", hashXml),
      { id: crypto.randomUUID(), kind: "document_event", period: notaAtual.period, data: { documentId: xmlId, event: "generated", actor: atual.u.email, actorId: atual.u.id, at: agora, detail: `NFS-e autorizada pela Sefin Nacional (${ambiente === "producao" ? "produção" : "produção restrita"}). Chave ${resultado.chaveAcesso}.` } },
    ];
    if (pdfId && pdfCaminho && pdf && hashPdf) entradas.push(doc(pdfId, `DANFSe_${numeroNfse}.pdf`, pdfCaminho, pdf.byteLength, "application/pdf", hashPdf));
    await persist(atual, { upserts: entradas, event: "nfse_emitida", detail: `NFS-e ${numeroNfse} autorizada (${d.customer}, chave ${resultado.chaveAcesso}).` });
  });
  await admin.from("notas_fiscais").update({ chave_acesso: resultado.chaveAcesso, documento_xml_id: xmlId, documento_pdf_id: pdfId }).eq("id", notaId);

  return {
    numeroNfse,
    chaveAcesso: resultado.chaveAcesso,
    ambiente,
    alertas: resultado.alertas,
    danfse: !!pdf,
  };
}
