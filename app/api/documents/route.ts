import { bucket, context, fail, getState, persist, sameOrigin } from '@/lib/server';
import { getPeriod, requireThat, textField, type Entry } from '@/lib/domain';
export async function POST(request:Request){try{
 sameOrigin(request);requireThat(Number(request.headers.get('content-length')||0)<=10_200_000,'Limite de 10 MB por documento.',413);
 const form=await request.formData(),file=form.get('file');requireThat(file instanceof File&&file.size>0&&file.size<=10_000_000,'Selecione um arquivo de até 10 MB.');
 const companyId=textField(form.get('companyId'),'Empresa'),category=textField(form.get('category'),'Categoria'),selectedPeriod=textField(form.get('period'),'Competência',7),ctx=await context(companyId);
 requireThat(['accountant','owner','finance'].includes(ctx.role),'Seu perfil não pode anexar estes documentos.',403);
 requireThat(['monthly','invoice','tax','other','corporate','people','payroll','notification'].includes(category),'Categoria inválida.');
 requireThat(category!=='people'||['owner','accountant'].includes(ctx.role),'Documentos pessoais têm acesso restrito ao administrador e contador.',403);
 const permanent=['corporate','people'].includes(category),period=permanent?'permanent':selectedPeriod,p=getPeriod(ctx.records,selectedPeriod);requireThat(p,'Competência indisponível.');
 requireThat(permanent||p.data.status==='open'||ctx.role==='accountant','Reabra o mês para acrescentar documentos à base.');
 const previousId=String(form.get('previousId')||'');const previous=previousId?ctx.records.find(r=>r.id===previousId&&r.kind==='document'):null;
 requireThat(!previousId||previous&&previous.period===period&&previous.data.category===category,'A nova versão deve permanecer na pasta e competência do original.');
 requireThat(!previous||!ctx.records.some(r=>r.kind==='document'&&r.data.previousId===previous.id),'Selecione a versão mais recente do documento para criar a próxima versão.');
 const bytes=await file.arrayBuffer(),b=new Uint8Array(bytes),signature=new TextDecoder().decode(b.slice(0,5));
 const mime=signature==='%PDF-'?'application/pdf':b[0]===0xff&&b[1]===0xd8?'image/jpeg':b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47?'image/png':null;requireThat(mime,'Use PDF, JPG ou PNG.');
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const id=crypto.randomUUID(),key=`${ctx.m.workspace_id}/${companyId}/${id}`,now=new Date().toISOString();
 const name=file.name.replace(/[^\p{L}\p{N} ._-]/gu,'_').slice(0,180),data={name,category,key,size:file.size,mime,uploadedAt:now,uploadedBy:ctx.u.email,sha256:hash,version:previous?(previous.data.version||1)+1:1,previousId:previous?.id||null,acknowledgments:[],scope:permanent?'permanent':'monthly'};
 await bucket().put(key,bytes,{httpMetadata:{contentType:mime}});
 const entries:Entry[]=[{id,kind:'document',period,data},{id:crypto.randomUUID(),kind:'document_event',period,data:{documentId:id,event:'uploaded',actor:ctx.u.email,actorId:ctx.u.id,at:now,detail:`Arquivo v${data.version} disponível no portal. SHA-256: ${hash}.`}}];
 if(['tax','notification','payroll'].includes(category))entries.push({id:crypto.randomUUID(),kind:'notification',period:selectedPeriod,data:{title:`Documento disponível: ${name}`,body:'A contabilidade disponibilizou este documento. Abra o arquivo e confirme sua ciência.',documentId:id,createdAt:now,channel:'portal',readBy:[],audience:'client'}});
 try{await persist(ctx,{upserts:entries,event:'document_upload',detail:`Documento ${name}, v${data.version}, anexado em ${period}. Original preservado.`},Number(form.get('version')));}catch(e){await bucket().delete(key);throw e;}
 return Response.json({state:await getState(companyId,selectedPeriod),message:'Documento armazenado com identificação, versão e histórico.'},{headers:{'Cache-Control':'no-store'}});
}catch(e){return fail(e);}}
export async function GET(request:Request){try{
 const url=new URL(request.url),ctx=await context(url.searchParams.get('company')||''),doc=ctx.records.find(r=>r.id===url.searchParams.get('id')&&r.kind==='document');
 requireThat(doc&&(ctx.role!=='issuer'||doc.data.category==='invoice')&&(doc.data.category!=='people'||['owner','accountant'].includes(ctx.role)),'Documento indisponível para este acesso.',404);
 const object=await bucket().get(doc.data.key);requireThat(object,'Arquivo não encontrado.',404);
 const now=new Date().toISOString(),inline=url.searchParams.get('view')==='1'&&['application/pdf','image/png','image/jpeg'].includes(doc.data.mime),detail=`${inline?'Abertura':'Download'} solicitado: ${doc.data.name}, v${doc.data.version||1}. Não comprova leitura.`;
 await ctx.db.batch([
  ctx.db.prepare('INSERT INTO audit (id,company_id,actor_id,actor_email,action,detail,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),ctx.company.id,ctx.u.id,ctx.u.email,'document_access_requested',detail,now),
  ctx.db.prepare('INSERT INTO records (id,company_id,kind,period,data,updated_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),ctx.company.id,'document_event',doc.period,JSON.stringify({documentId:doc.id,event:inline?'view_requested':'download_requested',actor:ctx.u.email,actorId:ctx.u.id,at:now,detail}),now)
 ]);
 return new Response(object.body,{headers:{'Content-Type':doc.data.mime,'Content-Disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(doc.data.name)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Content-Security-Policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'"}});
}catch(e){return fail(e);}}
