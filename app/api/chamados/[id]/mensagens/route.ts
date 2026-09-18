import { fail, identity, portalDe, sameOrigin } from "@/lib/server";
import { enviarMensagem } from "@/lib/carteira";

// O lado (escritório ou cliente) vem do portal de onde a mensagem foi enviada;
// o RLS confere se o usuário realmente tem esse papel na empresa.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const { sb, u } = await identity();
    const { corpo } = await request.json();
    const lado = portalDe(request) === "cliente" ? "cliente" : "escritorio";
    await enviarMensagem(sb, u, (await params).id, String(corpo ?? ""), lado);
    return Response.json({ message: "Mensagem enviada." }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
