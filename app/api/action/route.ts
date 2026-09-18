import { comRetentativa, context, fail, getState, persist, portalDe, sameOrigin, type Portal } from "@/lib/server";
import { requireThat } from "@/lib/domain";
import { applyAction } from "@/lib/contagiro";
import { accountingAction } from "@/lib/reporting";
import { criarConvite } from "@/lib/convites";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    requireThat(Number(request.headers.get("content-length") || 0) <= 100000, "Solicitação muito grande.", 413);
    const raw = await request.text();
    requireThat(raw.length <= 100000, "Solicitação muito grande.", 413);
    const a = JSON.parse(raw);
    requireThat(typeof a.companyId === "string", "Escolha uma empresa.");
    const portal: Portal = portalDe(request, a.portal);

    // Convite: fluxo próprio, com token de uso único enviado por link.
    if (a.type === "invite") {
      const ctx = await context(a.companyId);
      const link = await criarConvite(ctx, { email: a.email, role: a.role }, new URL(request.url).origin);
      return Response.json(
        { state: await getState(portal, a.returnCompanyId || a.companyId, a.period), link, message: "Convite criado. O link foi copiado; envie à pessoa convidada (válido por 7 dias)." },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const detail = await comRetentativa(async () => {
      const ctx = await context(a.companyId);
      if (a.returnCompanyId && a.returnCompanyId !== a.companyId) await context(a.returnCompanyId);
      const now = new Date().toISOString();
      const change = accountingAction(ctx.company, ctx.records, ctx.role, a, now, ctx.u)
        || applyAction(ctx.company, ctx.records, ctx.role, a, now, ctx.u);
      await persist(ctx, change);
      return change.detail;
    });
    return Response.json(
      { state: await getState(portal, a.returnCompanyId || a.companyId, a.period), message: detail },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
