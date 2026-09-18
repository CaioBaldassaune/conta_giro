import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const mf=new Miniflare({modules:true,scriptPath:"dist/server/index.js",modulesRules:[{type:"ESModule",include:["**/*.js","**/*.mjs"]}],compatibilityDate:"2026-05-15",compatibilityFlags:["nodejs_compat"],d1Databases:["DB"],r2Buckets:["DOCUMENTS"]});
try{
  const db=await mf.getD1Database("DB");const migration=await readFile("drizzle/0000_chief_the_hand.sql","utf8");for(const statement of migration.split("--> statement-breakpoint").map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
  const auth={"oai-authenticated-user-id":"test-owner-A","oai-authenticated-user-email":"owner-a@example.com","origin":"http://localhost"};
  async function request(path,init={},headers=auth){const res=await mf.dispatchFetch(`http://localhost${path}`,{...init,headers:{...headers,...init.headers}});const raw=await res.text();let data;try{data=JSON.parse(raw);}catch{throw Error(`${path}: ${res.status} ${raw.slice(0,250)}`);}return {res,data};}
  assert.equal((await request("/api/state",{},{})).res.status,401);
  let {res,data:state}=await request("/api/state");assert.equal(res.status,200,JSON.stringify(state));assert.equal(state.companies.length,3);assert.equal(state.records.filter(r=>r.kind==="transaction").length,8);
  const companyId=state.selectedCompany;let version=state.companies.find(c=>c.id===companyId).version;
  const action={type:"classify",ids:[`${companyId}:tx5`],category:"telecom",companyId,period:"2026-08",version};
  const changed=await request("/api/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(action)});assert.equal(changed.res.status,200,JSON.stringify(changed.data));
  const stale=await request("/api/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(action)});assert.equal(stale.res.status,409);
  const persisted=await request(`/api/state?company=${companyId}`);assert.equal(persisted.data.records.find(r=>r.id===`${companyId}:tx5`).data.category,"telecom");state=persisted.data;version=state.companies.find(c=>c.id===companyId).version;
  const outsider=await request(`/api/state?company=${companyId}`,{}, {...auth,"oai-authenticated-user-id":"test-owner-B","oai-authenticated-user-email":"owner-b@example.com"});assert.equal(outsider.res.status,404);
  const wrongOrigin=await request("/api/action",{method:"POST",headers:{"Content-Type":"application/json","origin":"http://other.test"},body:JSON.stringify({...action,version})});assert.equal(wrongOrigin.res.status,403);
  const upload=new FormData();upload.set("companyId",companyId);upload.set("period","2026-08");upload.set("version",String(version));upload.set("category","monthly");upload.set("file",new File(["%PDF-1.4\n% test fixture\n%%EOF"],"demonstracao.pdf",{type:"application/pdf"}));
  const uploaded=await request("/api/documents",{method:"POST",body:upload});assert.equal(uploaded.res.status,200,JSON.stringify(uploaded.data));const doc=uploaded.data.state.records.find(r=>r.kind==="document");assert.ok(doc);
  const download=await mf.dispatchFetch(`http://localhost/api/documents?company=${companyId}&id=${doc.id}`,{headers:auth});assert.equal(download.status,200);assert.match(await download.text(),/%PDF-/);assert.equal(download.headers.get("x-content-type-options"),"nosniff");
  version=uploaded.data.state.companies.find(c=>c.id===companyId).version;
  const makeImport=(commit)=>{const f=new FormData();f.set("companyId",companyId);f.set("period","2026-08");f.set("version",String(version));f.set("account","Conta teste");f.set("commit",String(commit));f.set("file",new File(["Data;Descrição;Valor;ID\n05/08/2026;TESTE FORNECEDOR;-49,90;fixture-001"],"extrato.csv"));return f;};
  const preview=await request("/api/import",{method:"POST",body:makeImport(false)});assert.equal(preview.res.status,200,JSON.stringify(preview.data));assert.equal(preview.data.count,1);
  const imported=await request("/api/import",{method:"POST",body:makeImport(true)});assert.equal(imported.res.status,200,JSON.stringify(imported.data));version=imported.data.state.companies.find(c=>c.id===companyId).version;
  const duplicate=await request("/api/import",{method:"POST",body:makeImport(false)});assert.equal(duplicate.data.count,0);assert.equal(duplicate.data.duplicates,1);
  console.log("API verification passed: authentication, tenant isolation, CSRF, persistence, stale writes, R2 upload/download, CSV import and duplicate detection.");
}finally{await mf.dispose();}
