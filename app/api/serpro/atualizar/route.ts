import { fail, identity, sameOrigin } from "@/lib/server";
import { requireThat } from "@/lib/domain";
import { carregarCredenciais } from "@/lib/serpro";
import { atualizarSituacao } from "@/lib/serpro-servicos";
import { clienteAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOTE_MAXIMO = 20; // a tela envia a carteira em partes para caber no tempo da função
const SIMULTANEAS = 4;

// Consulta Caixa Postal + PGDAS-D das empresas selecionadas e atualiza o painel.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { sb, u } = await identity();
    const { empresaIds, competencia } = await request.json();
    requireThat(Array.isArray(empresaIds) && empresaIds.length >= 1 && empresaIds.length <= LOTE_MAXIMO, `Envie de 1 a ${LOTE_MAXIMO} empresas por vez.`);
    requireThat(/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia), "Competência inválida.");

    // O RLS garante que só voltam empresas visíveis ao usuário; conferimos que ele é equipe.
    const { data: empresas } = await sb.from("empresas").select("id, razao_social, cnpj, escritorio_id").in("id", empresaIds);
    requireThat(empresas?.length, "Nenhuma empresa disponível.", 404);
    const { data: equipe } = await sb.from("membros_escritorio").select("escritorio_id").eq("usuario_id", u.id);
    const escritorios = new Set((equipe ?? []).map((m) => m.escritorio_id));
    requireThat(empresas.every((e) => escritorios.has(e.escritorio_id)), "Somente a equipe do escritório consulta o SERPRO.", 403);

    const admin = clienteAdmin();
    const cred = await carregarCredenciais(admin, empresas[0].escritorio_id);
    const resultados: { empresaId: string; empresa: string; ok: boolean; mensagem: string }[] = [];
    const fila = [...empresas];
    await Promise.all(Array.from({ length: SIMULTANEAS }, async () => {
      for (let e = fila.shift(); e; e = fila.shift()) {
        if (!e.cnpj) {
          resultados.push({ empresaId: e.id, empresa: e.razao_social, ok: false, mensagem: "CNPJ não cadastrado." });
          continue;
        }
        try {
          const r = await atualizarSituacao(admin, cred, { id: e.id, cnpj: e.cnpj }, competencia, u.id);
          const caixa = ["sem mensagens novas", "1 mensagem nova", "várias mensagens novas"][r.caixaPostal] ?? String(r.caixaPostal);
          resultados.push({ empresaId: e.id, empresa: e.razao_social, ok: true, mensagem: `PGDAS-D ${r.pgdasTransmitida ? "entregue" : "não entregue"} • Caixa Postal: ${caixa}` });
        } catch (erro) {
          resultados.push({ empresaId: e.id, empresa: e.razao_social, ok: false, mensagem: (erro as Error).message });
        }
      }
    }));
    const ok = resultados.filter((r) => r.ok).length;
    return Response.json({ resultados, message: `${ok} de ${resultados.length} empresa(s) atualizada(s) no SERPRO.` }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
