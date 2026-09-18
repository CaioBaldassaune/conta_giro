import { getState, fail } from "@/lib/server";
export const dynamic="force-dynamic";
export async function GET(request:Request){try {const companyId=new URL(request.url).searchParams.get("company")||undefined;return Response.json(await getState(companyId,new URL(request.url).searchParams.get("period")||undefined),{headers:{"Cache-Control":"no-store"}});}catch(e){return fail(e);}}
