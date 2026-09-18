import { context, fail, sameOrigin } from "@/lib/server";
import { DomainError, requireThat } from "@/lib/domain";
import { carregarCredenciais } from "@/lib/serpro";
import { verificarProcuracao } from "@/lib/serpro-servicos";
import { clienteAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Verifica a procuração no e-CAC com uma consulta NÃO cobrada (Caixa Postal / Monitorar).
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { empresaId } = await request.json();
    const ctx = await context(empresaId);
    requireThat(ctx.role === "accountant", "Somente a equipe do escritório verifica procurações.", 403);
    requireThat(ctx.company.data.cnpj, "Cadastre o CNPJ da empresa.");
    const admin = clienteAdmin();
    const cred = await carregarCredenciais(admin, ctx.escritorioId);
    try {
      await verificarProcuracao(admin, cred, { id: empresaId, cnpj: ctx.company.data.cnpj }, ctx.u.id);
    } catch (e) {
      if (e instanceof DomainError && e.status === 403) {
        throw new DomainError(`A procuração ainda não aparece no e-CAC para o escritório (CNPJ ${cred.cnpjContratante}). Nenhuma cobrança foi gerada nesta verificação.`, 409);
      }
      throw e;
    }
    return Response.json({ message: "Procuração confirmada (verificação não cobrada). As consultas ao SERPRO foram liberadas para esta empresa." }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
