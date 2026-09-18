import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { DomainError, requireThat, visibleKinds, type Company, type Entry, type Role, type Change, type WorkspaceState } from "./domain";
import { demoCompany, demoRecords } from "./seed";
import { RECORD_UPSERT_SQL, SEED_RECORDS_SQL } from "./persistence-query";

type DB = {prepare:(sql:string)=>any;batch:(statements:any[])=>Promise<any[]>};
export function database():DB {const db=(env as unknown as {DB:DB}).DB;if(!db)throw new DomainError("O armazenamento ainda está sendo preparado. Tente novamente em instantes.",503);return db;}
export function bucket():any {const b=(env as unknown as {DOCUMENTS:any}).DOCUMENTS;if(!b)throw new DomainError("Armazenamento de documentos indisponível.",503);return b;}
export async function identity(){const user=await getChatGPTUser();const h=await headers();const id=h.get("oai-authenticated-user-id");requireThat(user&&id,"Entre com sua conta para acessar o portal.",401);return {...user,id};}
export function sameOrigin(request:Request){const origin=request.headers.get("origin"),site=new URL(request.url);requireThat(origin&&new URL(origin).host===site.host,"Origem da solicitação inválida.",403);}
export function fail(e:unknown){const status=e instanceof DomainError?e.status:500;return Response.json({error:e instanceof DomainError?e.message:"Não foi possível concluir. Nenhuma confirmação de sucesso foi registrada. Tente novamente."},{status,headers:{"Cache-Control":"no-store"}});}
export async function getMembership(){const u=await identity(),db=database();let m=await db.prepare("SELECT * FROM members WHERE user_id = ? LIMIT 1").bind(u.id).first();
  if(!m){
    // Each identity gets its own isolated demonstration workspace. No membership is granted to an existing workspace.
    const workspaceId=crypto.randomUUID(),memberId=crypto.randomUUID(),now=new Date().toISOString();
    const names=["Aurora Serviços Administrativos","Estúdio Horizonte","Prisma Engenharia"];
    const statements=[db.prepare("INSERT OR IGNORE INTO workspaces (id,owner_id,name,created_at) VALUES (?,?,?,?)").bind(workspaceId,u.id,"ContaGiro Contabilidade",now),db.prepare("INSERT INTO members (id,workspace_id,user_id,email,role,company_id) SELECT ?,?,?,?,'accountant',NULL WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?)").bind(memberId,workspaceId,u.id,u.email,workspaceId)];
    names.forEach((name,i)=>{const c=demoCompany(crypto.randomUUID(),name);statements.push(db.prepare("INSERT INTO companies (id,workspace_id,name,data,version) SELECT ?,?,?,?,0 WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?)").bind(c.id,workspaceId,c.name,JSON.stringify(c.data),workspaceId));statements.push(db.prepare(SEED_RECORDS_SQL).bind(c.id,now,JSON.stringify(demoRecords(c.id,i)),c.id));});
    try{await db.batch(statements);}catch(e){const existing=await db.prepare("SELECT id FROM members WHERE user_id = ? LIMIT 1").bind(u.id).first();if(!existing)throw e;}
    m=await db.prepare("SELECT * FROM members WHERE user_id = ? LIMIT 1").bind(u.id).first();
  }requireThat(m,"Acesso não habilitado.",403);return {u,m,db};
}
export async function context(companyId:string){const {u,m,db}=await getMembership();const row=await db.prepare("SELECT * FROM companies WHERE id = ? AND workspace_id = ?").bind(companyId,m.workspace_id).first();
  requireThat(row&&(!m.company_id||m.company_id===companyId),"Empresa não disponível para este acesso.",404);
  const company:Company={id:row.id,name:row.name,version:row.version,data:JSON.parse(row.data)};
  const result=await db.prepare("SELECT id,kind,period,data FROM records WHERE company_id = ? ORDER BY updated_at, id").bind(companyId).all();
  return {u,m,db,company,records:result.results.map((r:any)=>({...r,data:JSON.parse(r.data)})) as Entry[],role:m.role as Role};
}
export async function getState(companyId?:string,period="2026-08"):Promise<WorkspaceState>{const {u,m,db}=await getMembership();const rows=await db.prepare("SELECT * FROM companies WHERE workspace_id = ? AND (? IS NULL OR id = ?) ORDER BY name").bind(m.workspace_id,m.company_id,m.company_id).all();
  const companies:Company[]=rows.results.map((r:any)=>({id:r.id,name:r.name,data:JSON.parse(r.data),version:r.version}));
  const selected=companyId||companies[0]?.id;requireThat(companies.some(c=>c.id===selected),"Empresa indisponível.",404);
  const c=await context(selected),kindSet=visibleKinds(c.role);
  const logs=c.role==="accountant"||c.role==="owner"?(await db.prepare("SELECT id,actor_email,action,detail,created_at FROM audit WHERE company_id = ? ORDER BY created_at DESC LIMIT 60").bind(selected).all()).results:[];
  const visibleDocIds=new Set(c.records.filter(r=>r.kind==="document"&&(c.role!=="issuer"||r.data.category==="invoice")&&(r.data.category!=="people"||["owner","accountant"].includes(c.role))).map(r=>r.id));
  const visible=c.records.filter(r=>kindSet.includes(r.kind)&&(r.kind!=="document_event"||visibleDocIds.has(r.data.documentId))&&(!["employee","payroll"].includes(r.kind)||["owner","accountant"].includes(c.role))&&(!["lead","task","accounting","journal","tax_version"].includes(r.kind)||c.role==="accountant")&&(r.kind!=="document"||r.data.category!=="people"||["owner","accountant"].includes(c.role))&&(c.role!=="issuer"||r.kind!=="document"||r.data.category==="invoice")&&(c.role!=="issuer"||r.kind!=="contact"||["customer","both"].includes(r.data.contactType))).map(r=>c.role==="issuer"&&r.kind==="period"?{...r,data:{status:r.data.status}}:!["owner","accountant"].includes(c.role)&&r.kind==="period"?{...r,data:{status:r.data.status,bankConfirmed:r.data.bankConfirmed,revenueConfirmed:r.data.revenueConfirmed,noMovement:r.data.noMovement,lastBatch:r.data.lastBatch}}:r);
  let portfolio:WorkspaceState["portfolio"]=undefined;
  if(c.role==="accountant"){
    const all=await db.prepare("SELECT r.company_id,r.id,r.kind,r.period,r.data FROM records r JOIN companies c ON c.id=r.company_id WHERE c.workspace_id=? AND (? IS NULL OR c.id=?) ORDER BY r.period,r.id").bind(m.workspace_id,m.company_id,m.company_id).all();
    portfolio=companies.map(company=>({company,records:all.results.filter((r:any)=>r.company_id===company.id).map((r:any)=>({id:r.id,kind:r.kind,period:r.period,data:JSON.parse(r.data)}))}));
  }
  const available=c.records.filter(r=>r.kind==="period").map(r=>r.period);
  const selectedPeriod=available.includes(period)?period:available.sort().at(-1)||"2026-08";
  return {period:selectedPeriod,portfolio,companies,records:visible,selectedCompany:selected,audit:logs,user:{name:u.displayName,email:u.email,role:c.role}};
}
export async function persist(ctx:Awaited<ReturnType<typeof context>>,change:Change,expected:number){
  requireThat(Number.isInteger(expected)&&expected===ctx.company.version,"Os dados mudaram. Atualize a página e revise sua ação.",409);const now=new Date().toISOString(),id=ctx.company.id,db=ctx.db;
  const statements=[db.prepare(RECORD_UPSERT_SQL).bind(id,now,JSON.stringify(change.upserts),id,expected)];
  statements.push(db.prepare("INSERT INTO audit (id,company_id,actor_id,actor_email,action,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM companies WHERE id = ? AND version = ?)").bind(crypto.randomUUID(),id,ctx.u.id,ctx.u.email,change.event,change.detail,now,id,expected));
  statements.push(change.company?db.prepare("UPDATE companies SET data = ?, name = ?, version = version + 1 WHERE id = ? AND version = ?").bind(JSON.stringify(change.company.data),change.company.name,id,expected):db.prepare("UPDATE companies SET version = version + 1 WHERE id = ? AND version = ?").bind(id,expected));
  const results=await db.batch(statements);requireThat(results[results.length-1].meta.changes===1,"Outra pessoa alterou os dados. Atualize e tente novamente.",409);
}
