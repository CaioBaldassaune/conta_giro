import { comRetentativa, context, fail, persist, sameOrigin, type Contexto } from "@/lib/server";
import { exigirMesEncerrado, monthLabel, normalize, requireThat, type Entry } from "@/lib/domain";
import { caminhoDocumento, enviarArquivo, sha256 } from "@/lib/arquivos";
import { carregarCredenciais } from "@/lib/serpro";
import { declararPgdas } from "@/lib/serpro-servicos";
import { ATIVIDADES_SN, TRIBUTOS_SN, mesesAnteriores, proporReceitas, type ReceitaSn, type ValorDevido } from "@/lib/pgdas";
import { clienteAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

async function contextoDoContador(empresaId: string, competencia: string) {
  requireThat(COMPETENCIA.test(competencia), "Competência inválida.");
  const ctx = await context(empresaId);
  requireThat(ctx.role === "accountant", "Somente a equipe do escritório transmite a declaração.", 403);
  requireThat(ctx.company.data.cnpj, "Cadastre o CNPJ da empresa.");
  return ctx;
}

/** Folhas dos 12 meses anteriores validadas no ContaGiro (Fator R), ou null se faltar algum mês. */
function folhasFatorR(ctx: Contexto, competencia: string) {
  const folhas = mesesAnteriores(competencia).map((m) => {
    const h = ctx.records.find((r) => r.kind === "history" && r.period === m && r.data.payrollValidated);
    return h ? { competencia: m, valor: Number(h.data.payroll ?? 0) } : null;
  });
  return folhas.every(Boolean) ? (folhas as { competencia: string; valor: number }[]) : null;
}

// Proposta da declaração a partir das notas da competência (o contador confere antes de enviar).
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const competencia = params.get("competencia") ?? "";
    const ctx = await contextoDoContador(params.get("empresa") ?? "", competencia);
    const municipio = normalize(ctx.company.data.tax.municipality || "");
    const validas = ctx.company.data.demo ? ["authorized", "simulated"] : ["authorized"];
    const notas = ctx.records.filter((r) => r.kind === "invoice" && r.period === competencia && validas.includes(r.data.status));
    const { receitas, avisos } = proporReceitas(notas.map((n) => ({
      valor: Number(n.data.amount), anexo: n.data.activitySnapshot?.annex ?? "III", issRetido: !!n.data.issRetained,
      outroMunicipio: !!n.data.serviceLocation && normalize(n.data.serviceLocation) !== municipio, numero: n.data.number,
    })));

    const admin = clienteAdmin();
    const [{ data: situacao }, { data: ultimas }] = await Promise.all([
      admin.from("situacoes_fiscais").select("pgdas_transmitida, pgdas_id_declaracao, pgdas_valor_devido").eq("empresa_id", ctx.company.id).eq("competencia", competencia).maybeSingle(),
      admin.from("declaracoes_pgdas").select("transmitida, total_devido, criado_em").eq("empresa_id", ctx.company.id).eq("competencia", competencia).order("criado_em", { ascending: false }).limit(1),
    ]);

    const bloqueios: string[] = [];
    try { exigirMesEncerrado(competencia); } catch (e) { bloqueios.push((e as Error).message); }
    if (ctx.company.data.tax.regime === "caixa") bloqueios.push("Empresa no regime de caixa: por enquanto transmita pelo Domínio (o ContaGiro preenche só o regime de competência).");
    if (receitas.some((r) => r.idAtividade === 11 || r.idAtividade === 12) && !folhasFatorR(ctx, competencia)) {
      avisos.push("Atividade com Fator R: faltam folhas validadas dos 12 meses anteriores no ContaGiro. O SERPRO usará as folhas já informadas em declarações anteriores.");
    }
    const periodo = ctx.records.find((r) => r.kind === "period" && r.period === competencia);
    if (!["reviewed", "approved"].includes(periodo?.data.status)) avisos.push(`A apuração de ${monthLabel(competencia)} ainda não foi revisada no ContaGiro.`);
    if (notas.length === 0) avisos.push("Nenhuma nota autorizada no ContaGiro nesta competência. Se houve faturamento fora do ContaGiro (ex.: WebISS), informe as receitas.");

    return Response.json({
      competencia, cnpj: ctx.company.data.cnpj, razaoSocial: ctx.company.name,
      receitas, avisos, bloqueios, notas: notas.length,
      tipoSugerido: situacao?.pgdas_transmitida ? 2 : 1,
      transmitida: situacao?.pgdas_transmitida ?? null, idDeclaracao: situacao?.pgdas_id_declaracao ?? null, valorDevido: situacao?.pgdas_valor_devido ?? null,
      ultima: ultimas?.[0] ?? null, atividades: ATIVIDADES_SN, tributos: TRIBUTOS_SN,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

// Prévia (cálculo sem transmitir) ou transmissão da declaração.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const d = await request.json();
    const ctx = await contextoDoContador(String(d.empresaId ?? ""), String(d.competencia ?? ""));
    const competencia: string = d.competencia;
    exigirMesEncerrado(competencia);
    requireThat(ctx.company.data.tax.regime !== "caixa", "Regime de caixa: transmita pelo Domínio por enquanto.");
    requireThat(d.modo === "previa" || d.modo === "transmitir", "Escolha entre prévia e transmissão.");
    const transmitir = d.modo === "transmitir";
    requireThat(!transmitir || d.confirmar === true, "Confirme a conferência das receitas antes de transmitir.");
    requireThat(Array.isArray(d.receitas) && d.receitas.length <= 10, "Receitas inválidas.");
    const receitas: ReceitaSn[] = d.receitas.map((r: ReceitaSn) => ({ idAtividade: Number(r.idAtividade), valor: Math.round(Number(r.valor)) }));
    const total = receitas.reduce((s, r) => s + r.valor, 0);
    requireThat(!transmitir || total === 0 || Array.isArray(d.valoresParaComparacao), "Calcule a prévia antes de transmitir.");
    const valoresParaComparacao: ValorDevido[] | undefined = d.valoresParaComparacao?.map((v: ValorDevido) => ({ codigoTributo: Number(v.codigoTributo), valor: Number(v.valor) }));
    const tipo = d.tipo === 2 ? 2 : 1;

    const admin = clienteAdmin();
    const cred = await carregarCredenciais(admin, ctx.escritorioId);
    const fatorR = receitas.some((r) => r.idAtividade === 11 || r.idAtividade === 12);
    const resultado = await declararPgdas(admin, cred, {
      cnpj: ctx.company.data.cnpj, competencia, tipo, receitas, transmitir,
      folhas: fatorR ? folhasFatorR(ctx, competencia) ?? undefined : undefined,
      valoresParaComparacao,
    }, { empresaId: ctx.company.id, usuarioId: ctx.u.id });

    // Transmitida: arquiva recibo/declaração (e MAED/DARF, se houver multa) e avisa o cliente.
    const arquivos: { id: string; nome: string; base64: string }[] = [];
    if (transmitir) {
      const sufixo = resultado.idDeclaracao ? `_${resultado.idDeclaracao}` : "";
      for (const [nome, base64] of [["Recibo_PGDAS-D", resultado.pdfRecibo], ["Declaracao_PGDAS-D", resultado.pdfDeclaracao], ["Notificacao_MAED", resultado.pdfMaed], ["DARF_MAED", resultado.pdfDarf]] as const) {
        if (base64) arquivos.push({ id: crypto.randomUUID(), nome: `${nome}_${competencia}${sufixo}.pdf`, base64 });
      }
      const guardados: Entry[] = [];
      for (const a of arquivos) {
        const bytes = Buffer.from(a.base64, "base64");
        const caminho = caminhoDocumento(ctx.escritorioId, ctx.company.id, a.id);
        await enviarArquivo(ctx.sb, caminho, bytes, "application/pdf");
        guardados.push({ id: a.id, kind: "document", period: competencia, data: { name: a.nome, category: "tax", key: caminho, size: bytes.byteLength, mime: "application/pdf", sha256: await sha256(bytes), version: 1, uploadedAt: new Date().toISOString(), uploadedBy: ctx.u.email, acknowledgments: [], scope: "monthly" } });
      }
      const devido = (resultado.totalDevido / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      await comRetentativa(async () => {
        const atual = await context(ctx.company.id);
        const now = new Date().toISOString();
        await persist(atual, {
          upserts: [
            ...guardados,
            ...guardados.map((g) => ({ id: crypto.randomUUID(), kind: "document_event" as const, period: competencia, data: { documentId: g.id, event: "generated", actor: atual.u.email, actorId: atual.u.id, at: now, detail: "PGDAS-D transmitida pelo SERPRO Integra Contador (PGDASD/TRANSDECLARACAO11)." } })),
            { id: crypto.randomUUID(), kind: "notification", period: competencia, data: {
              title: `Declaração do Simples de ${monthLabel(competencia)} entregue`,
              body: resultado.totalDevido > 0 ? `Valor devido: ${devido}. O DAS será disponibilizado nos documentos.` : "Sem faturamento no mês: não há guia (DAS) a pagar.",
              documentId: guardados[0]?.id ?? null, createdAt: now, channel: "portal", readBy: [], audience: "client" } },
          ],
          event: "pgdas_transmitida",
          detail: `PGDAS-D ${tipo === 2 ? "retificadora" : "original"} de ${competencia} transmitida (${resultado.idDeclaracao ?? "sem número"}); receita ${(total / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}; devido ${devido}.`,
        });
      });
      await admin.from("situacoes_fiscais").upsert({
        empresa_id: ctx.company.id, competencia, pgdas_transmitida: true, pgdas_transmitida_em: resultado.transmitidaEm ?? new Date().toISOString(),
        pgdas_id_declaracao: resultado.idDeclaracao, pgdas_valor_devido: resultado.totalDevido, pgdas_recibo_id: arquivos[0]?.id ?? null,
        ...(resultado.totalDevido === 0 ? { das_valor: 0, das_vencimento: null, das_pago: null } : {}),
        atualizado_em: new Date().toISOString(),
      }, { onConflict: "empresa_id,competencia" });
    }

    await admin.from("declaracoes_pgdas").insert({
      empresa_id: ctx.company.id, competencia, tipo, transmitida: transmitir, receita_interna: total,
      atividades: receitas, valores_devidos: resultado.valoresDevidos, total_devido: resultado.totalDevido,
      id_declaracao: resultado.idDeclaracao, transmitida_em: transmitir ? resultado.transmitidaEm ?? new Date().toISOString() : null,
      recibo_id: arquivos.find((a) => a.nome.startsWith("Recibo"))?.id ?? null, declaracao_id: arquivos.find((a) => a.nome.startsWith("Declaracao"))?.id ?? null,
      solicitado_por: ctx.u.id,
    });

    return Response.json({
      modo: d.modo, valoresDevidos: resultado.valoresDevidos, totalDevido: resultado.totalDevido, idDeclaracao: resultado.idDeclaracao, avisos: resultado.avisos,
      message: transmitir
        ? `Declaração de ${monthLabel(competencia)} transmitida${resultado.idDeclaracao ? ` (nº ${resultado.idDeclaracao})` : ""}. ${resultado.totalDevido > 0 ? "Agora gere o DAS." : "Sem valor devido: não há guia."}`
        : "Prévia calculada pelo SERPRO. Confira os valores antes de transmitir.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
