import { context, fail, sameOrigin } from "@/lib/server";
import { DomainError, requireThat } from "@/lib/domain";
import { exigirValido, lerCertificado } from "@/lib/certificado";
import { clienteAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Recebe o certificado A1 (e-CNPJ) da empresa emitente e guarda no cofre.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const form = await request.formData();
    const empresaId = String(form.get("empresaId") ?? "");
    const arquivo = form.get("certificado");
    const senha = String(form.get("senha") ?? "");
    const ctx = await context(empresaId);
    requireThat(ctx.role === "accountant", "Somente a equipe do escritório envia o certificado da empresa.", 403);
    requireThat(arquivo instanceof File && arquivo.size > 0 && arquivo.size <= 50_000, "Envie o certificado A1 (.pfx ou .p12).");
    requireThat(senha, "Informe a senha do certificado.");

    const pfx = new Uint8Array(await arquivo.arrayBuffer());
    const certificado = lerCertificado(pfx, senha);
    exigirValido(certificado);
    requireThat(certificado.cnpj, "Use o e-CNPJ da empresa (o certificado não traz CNPJ).");
    requireThat(!ctx.company.data.cnpj || certificado.cnpj === ctx.company.data.cnpj,
      `Este certificado é do CNPJ ${certificado.cnpj}, diferente do cadastro da empresa (${ctx.company.data.cnpj}).`);

    const admin = clienteAdmin();
    const guardar = async (valor: string, nome: string) => {
      const { data, error } = await admin.rpc("cofre_guardar", { p_valor: valor, p_nome: `certificado:${empresaId}:${nome}` });
      if (error) throw new DomainError(`Não foi possível gravar no cofre: ${error.message}`, 500);
      return data as string;
    };
    const [arquivoId, senhaId] = [await guardar(Buffer.from(pfx).toString("base64"), "pfx"), await guardar(senha, "senha")];

    // O anterior deixa de valer (segredos removidos do cofre).
    const { data: anteriores } = await admin.from("certificados_digitais").select("id, arquivo_segredo_id, senha_segredo_id").eq("empresa_id", empresaId).eq("situacao", "ativo");
    for (const a of anteriores ?? []) {
      await admin.from("certificados_digitais").update({ situacao: "substituido" }).eq("id", a.id);
      await admin.rpc("cofre_apagar", { p_id: a.arquivo_segredo_id });
      await admin.rpc("cofre_apagar", { p_id: a.senha_segredo_id });
    }
    const { error } = await admin.from("certificados_digitais").insert({
      empresa_id: empresaId, cnpj: certificado.cnpj, titular: certificado.titular, valido_de: certificado.validoDe.toISOString(),
      valido_ate: certificado.validoAte.toISOString(), arquivo_segredo_id: arquivoId, senha_segredo_id: senhaId, situacao: "ativo", enviado_por: ctx.u.id,
    });
    if (error) throw new DomainError(`Não foi possível registrar o certificado: ${error.message}`, 500);
    if (!ctx.company.data.cnpj) await ctx.sb.from("empresas").update({ cnpj: certificado.cnpj }).eq("id", empresaId);
    await ctx.sb.from("registros_auditoria").insert({ empresa_id: empresaId, ator_id: ctx.u.id, ator_email: ctx.u.email, acao: "certificado_empresa_enviado", detalhe: `${certificado.titular}, válido até ${certificado.validoAte.toLocaleDateString("pt-BR")}.` });

    return Response.json({ message: `Certificado de ${certificado.titular} salvo (válido até ${certificado.validoAte.toLocaleDateString("pt-BR")}).` }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
