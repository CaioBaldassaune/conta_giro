import { context, fail, sameOrigin } from "@/lib/server";
import { DomainError, requireThat } from "@/lib/domain";
import { exigirValido, lerCertificado } from "@/lib/certificado";
import { clienteAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Certificado A1 (e-CNPJ) da empresa: o próprio cliente (sócio) envia pelo portal dele, ou a
// equipe do escritório. O arquivo e a senha vão direto para o cofre (Vault); nada volta à tela.
const PODEM_ENVIAR = ["accountant", "owner"];

// Situação do certificado (sem segredos), para a tela de primeiros passos do cliente.
export async function GET(request: Request) {
  try {
    const ctx = await context(new URL(request.url).searchParams.get("empresa") ?? "");
    const { data } = await clienteAdmin().from("certificados_digitais").select("titular, valido_ate").eq("empresa_id", ctx.company.id).eq("situacao", "ativo").maybeSingle();
    return Response.json({ certificado: data, podeEnviar: PODEM_ENVIAR.includes(ctx.role) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const form = await request.formData();
    const empresaId = String(form.get("empresaId") ?? "");
    const arquivo = form.get("certificado");
    const senha = String(form.get("senha") ?? "");
    const ctx = await context(empresaId);
    requireThat(PODEM_ENVIAR.includes(ctx.role), "Somente o sócio da empresa (ou o escritório) envia o certificado digital.", 403);
    // Cliente só envia certificado do CNPJ já cadastrado da própria empresa.
    requireThat(ctx.role === "accountant" || ctx.company.data.cnpj, "Cadastre o CNPJ da empresa antes de enviar o certificado.");
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
    if (!ctx.company.data.cnpj && ctx.role === "accountant") await ctx.sb.from("empresas").update({ cnpj: certificado.cnpj }).eq("id", empresaId);
    await admin.from("registros_auditoria").insert({ empresa_id: empresaId, ator_id: ctx.u.id, ator_email: ctx.u.email, acao: "certificado_empresa_enviado", detalhe: `${certificado.titular}, válido até ${certificado.validoAte.toLocaleDateString("pt-BR")} (enviado pelo ${ctx.role === "accountant" ? "escritório" : "cliente"}).` });

    return Response.json({ message: `Certificado de ${certificado.titular} salvo (válido até ${certificado.validoAte.toLocaleDateString("pt-BR")}).` }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
