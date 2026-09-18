import { getState, fail, portalDe } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const portal = portalDe(request, params.get("portal"));
    return Response.json(await getState(portal, params.get("company") || undefined, params.get("period") || undefined), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
