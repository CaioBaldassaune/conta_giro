import { acessos, fail, identity } from "@/lib/server";
import { requireThat } from "@/lib/domain";
import { equipeDoEscritorio } from "@/lib/carteira";

export const dynamic = "force-dynamic";

// Membros da equipe do escritório (para atribuir responsáveis aos chamados).
export async function GET() {
  try {
    const { sb, u } = await identity();
    const a = await acessos(sb, u.id);
    requireThat(a.escritorios.length, "Área exclusiva da equipe do escritório.", 403);
    return Response.json({ equipe: await equipeDoEscritorio(sb, a.escritorios) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
