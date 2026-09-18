import { acessos, fail, identity } from "@/lib/server";
import { requireThat } from "@/lib/domain";
import { painelCarteira } from "@/lib/carteira";

export const dynamic = "force-dynamic";

// Painel macro: uma linha por empresa da carteira, com alertas e totais.
export async function GET(request: Request) {
  try {
    const { sb, u } = await identity();
    const a = await acessos(sb, u.id);
    requireThat(a.escritorios.length, "Área exclusiva da equipe do escritório.", 403);
    const competencia = new URL(request.url).searchParams.get("competencia") || "2026-08";
    return Response.json(await painelCarteira(sb, competencia), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
