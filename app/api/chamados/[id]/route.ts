import { acessos, fail, identity, sameOrigin } from "@/lib/server";
import { requireThat } from "@/lib/domain";
import { atualizarChamado, detalharChamado } from "@/lib/carteira";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { sb } = await identity();
    return Response.json(await detalharChamado(sb, (await params).id), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

// Situação, prioridade, responsável e prazo: somente a equipe do escritório.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const { sb, u } = await identity();
    const a = await acessos(sb, u.id);
    requireThat(a.escritorios.length, "Somente a equipe do escritório altera o atendimento.", 403);
    await atualizarChamado(sb, u, (await params).id, await request.json());
    return Response.json({ message: "Chamado atualizado." }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
