import { fail, identity } from "@/lib/server";
import { DomainError, requireThat } from "@/lib/domain";
import { cnpjValido, dadosDaBrasilApi } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

// Consulta pública do CNPJ (BrasilAPI, dados abertos da Receita) para preencher o cadastro.
// Exige login para não virar um repasse aberto de consultas.
export async function GET(_request: Request, { params }: { params: Promise<{ cnpj: string }> }) {
  try {
    await identity();
    const cnpj = (await params).cnpj.replace(/\D/g, "");
    requireThat(cnpjValido(cnpj), "CNPJ inválido: confira os números.");
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) throw new DomainError("CNPJ não encontrado na base da Receita. Preencha os dados manualmente.", 404);
    if (!res.ok) throw new DomainError("A consulta do CNPJ está indisponível agora. Preencha os dados manualmente.", 502);
    return Response.json(dadosDaBrasilApi(await res.json()), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
