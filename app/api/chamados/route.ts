import { acessos, fail, identity, sameOrigin } from "@/lib/server";
import { requireThat } from "@/lib/domain";
import { abrirChamadosEmLote, listarChamados } from "@/lib/carteira";

export const dynamic = "force-dynamic";

// Fila única de chamados de todas as empresas visíveis ao usuário.
export async function GET(request: Request) {
  try {
    const { sb } = await identity();
    const p = new URL(request.url).searchParams;
    const chamados = await listarChamados(sb, {
      situacao: p.get("situacao") || undefined,
      empresaId: p.get("empresa") || undefined,
      responsavelId: p.get("responsavel") || undefined,
    });
    return Response.json({ chamados }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

// Abre o mesmo chamado para várias empresas (ação em lote do contador).
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { sb, u } = await identity();
    const a = await acessos(sb, u.id);
    requireThat(a.escritorios.length, "Somente a equipe do escritório abre chamados em lote.", 403);
    const dados = await request.json();
    const total = await abrirChamadosEmLote(sb, u, dados);
    return Response.json({ message: `${total} chamado(s) aberto(s) e avisado(s) no portal de cada cliente.` }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
