// Núcleo das regras de negócio (herdado da versão do ChatGPT Sites, mantido quase intacto).
// Tudo o que a empresa registra é um Entry { id, kind, period, data }: competência (period),
// lançamento (transaction), nota (invoice), documento, solicitação etc. reduceAction() aplica uma
// ação do usuário e devolve as alterações; nada aqui acessa banco ou rede, por isso é testável.
// Também concentra o calendário de competências (notas no mês corrente, apuração só de mês
// encerrado — horário de Brasília) e a matriz de permissões por papel (allowed()).
export type Role = "accountant" | "owner" | "finance" | "issuer" | "viewer";
export type Kind = "period" | "invoice" | "transaction" | "rule" | "payable" | "request" | "charge" | "document" | "history" | "invitation" | "contact" | "task" | "lead" | "subscription" | "employee" | "payroll" | "tax_version" | "notification" | "journal" | "accounting" | "document_event";
export type Entry = { id: string; kind: Kind; period: string; data: Record<string, any> };
export type Company = { id: string; name: string; version: number; data: {
  demo: boolean; cnpj: string; email: string; phone: string; active: boolean;
  tax: { regime: "competencia" | "caixa"; annex: "III" | "V" | "IV"; municipality: string; service: string; factorR: boolean; version: number; validated: boolean; activities?: Activity[]; confirmedAt?:string; confirmedBy?:string; effectiveFrom?:string };
} };
export type Activity={id:string;cnae:string;name:string;annex:"III"|"IV"|"V"|"factor_r";lc116:string;nationalCode:string;municipalCode:string;nbs:string;municipalRequired:boolean;nbsRequired:boolean;basis:string;issRule:string};
export type Audit = { id: string; actor_email: string; action: string; detail: string; created_at: string };
export type WorkspaceState = { period?:string; portfolio?:{company:Company;records:Entry[]}[]; companies: Company[]; records: Entry[]; audit: Audit[]; selectedCompany: string; user: { name: string; email: string; role: Role }; };
export const PERIOD = "2026-08";
// Calendário do escritório (horário de Brasília, UTC-3): notas fiscais só no mês corrente;
// apuração, envio e revisão só de mês já encerrado (em regra, o mês anterior).
export function hojeBrasilia(agora=new Date()) { return new Date(agora.getTime()-3*3600e3).toISOString().slice(0,10); }
export function mesAtual(agora=new Date()) { return hojeBrasilia(agora).slice(0,7); }
export function mesAnterior(mes:string) { const [a,m]=mes.split("-").map(Number); return m===1?`${a-1}-12`:`${a}-${String(m-1).padStart(2,"0")}`; }
export function mesApuracao(agora=new Date()) { return mesAnterior(mesAtual(agora)); }
export function exigirMesDeEmissao(period:string,agora=new Date()) { const atual=mesAtual(agora); requireThat(period===atual,`Notas fiscais só são emitidas na competência atual (${monthLabel(atual)}). Esta nota é de ${monthLabel(period)}: cancele o rascunho e prepare outro.`,409); }
export function exigirMesEncerrado(period:string,agora=new Date()) { const atual=mesAtual(agora); requireThat(period<atual,`${monthLabel(period)} ainda não terminou: a apuração só é feita com o mês encerrado. Apure ${monthLabel(mesAnterior(atual))}.`,409); }
export const categoryLabels: Record<string,string> = {
  revenue: "Receita de serviços", other_revenue:"Outras entradas / receitas a esclarecer", rent: "Aluguel e condomínio", software: "Software e assinaturas", telecom: "Internet e telefonia", taxes: "Tributos", people: "Pessoal", bank: "Tarifas bancárias", other_expense: "Outras despesas", service_cost:"Custos dos serviços", transfer: "Transferência entre contas", loan: "Empréstimo / aporte", adjustment: "Estorno / ajuste",
};
export const expenseCategories = ["service_cost","rent","software","telecom","taxes","people","bank","other_expense"];
export const roleLabels: Record<Role,string> = { accountant:"Contador responsável", owner:"Sócio / administrador", finance:"Financeiro", issuer:"Emissão de notas", viewer:"Somente consulta" };
export const stateLabels: Record<string,string> = {unavailable:"Mês não aberto",active:"Ativo",paused:"Pausado",validated:"Validado",incomplete:"Incompleto",contacted:"Contato registrado",converted:"Contratação concluída",lost:"Não prosseguiu",open:"Em preparação",submitted:"Enviado ao contador",reviewed:"Revisão concluída",approved:"Aprovado • integração pendente",draft:"Rascunho",simulated:"Simulada",canceled:"Cancelada",pending:"Pendente",paid_reported:"Pagamento informado",paid_confirmed:"Pagamento confirmado",new:"Recebida",in_progress:"Em atendimento",quoted:"Aguardando aceite",accepted:"Orçamento aceito",done:"Concluída"};
export function money(n: number) { return new Intl.NumberFormat("pt-BR", {style:"currency",currency:"BRL"}).format(n/100); }
export function dateLabel(s:string) { return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split("-").reverse().join("/") : s; }
export function monthLabel(s:string) { if(!/^\d{4}-\d{2}$/.test(s)) return s; return new Date(`${s}-15T12:00:00Z`).toLocaleDateString("pt-BR",{month:"long",year:"numeric",timeZone:"UTC"}); }
export class DomainError extends Error { status: number; constructor(message:string,status=422) {super(message);this.status=status;} }
export function requireThat(condition:unknown,message:string,status=422): asserts condition { if(!condition) throw new DomainError(message,status); }
export function parseMoney(value: unknown):number {
  const s=String(value??"").trim().replace(/R\$|\s/g,"");
  requireThat(/^-?(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{1,2})?$/.test(s) || /^-?\d+(?:\.\d{1,2})?$/.test(s),"Valor inválido. Use 1.234,56.");
  const normalized=s.includes(",") ? s.replace(/\./g,"").replace(",",".") : /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g,"") : s;
  const n=Math.round(Number(normalized)*100); requireThat(Number.isSafeInteger(n)&&Math.abs(n)<1e12,"Valor fora do limite.");return n;
}
export function normalize(s:string) {return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9 ]/g," ").replace(/\s+/g," ").trim();}
export function validDate(s:string) {return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0,10)===s;}
export function textField(value:unknown,label:string,max=180) {requireThat(typeof value==="string"&&value.trim().length>0&&value.trim().length<=max,`${label}: preencha até ${max} caracteres.`);return value.trim();}
export function visibleKinds(role:Role):Kind[] { if(role==="issuer")return ["invoice","period","document","contact"];if(role==="finance"||role==="viewer")return ["period","invoice","transaction","rule","payable","request","document","history","contact","notification","document_event"];return ["period","invoice","transaction","rule","payable","request","charge","document","history","invitation","contact","task","lead","subscription","employee","payroll","tax_version","notification","journal","accounting","document_event"];}
export function allowed(role:Role, action:string) {
  if(role==="accountant")return true;
  if(["history_save","matrix_save","task_save","task_status","subscription_save","subscription_pause","generate_charges","employee_save","payroll_save","accounting_save","journal_generate","journal_save","journal_validate","accounting_close","accounting_reopen","lead_save","lead_status","review_other","notify_risk","record_document_delivery","period_open","iss_review"].includes(action))return false;
  if(["payroll_request","matrix_request"].includes(action))return ["owner","finance"].includes(role);
  if(["contact_save","document_archive","document_restore"].includes(action))return ["owner","finance"].includes(role)||(role==="issuer"&&action==="contact_save");
  if(role==="viewer")return ["ack_document","read_notification"].includes(action);
  if(["tax_update","review","approve","reopen","set_request_status","quote_request","rule_toggle","invite"].includes(action))return role==="owner" && ["invite"].includes(action);
  if(role==="issuer")return ["invoice_create","invoice_simulate","invoice_cancel","ack_document","contact_save"].includes(action);
  if(role==="finance")return !["submit","accept_quote","report_charge","create_charge"].includes(action);
  return !["create_charge"].includes(action);
}
export function inPeriod(records:Entry[],kind:Kind,period=PERIOD) {return records.filter(r=>r.kind===kind&&r.period===period);}
export function getPeriod(records:Entry[],period=PERIOD) {return inPeriod(records,"period",period)[0];}
export function totals(records:Entry[],period=PERIOD) {
  const tx=inPeriod(records,"transaction",period), invoices=inPeriod(records,"invoice",period).filter(i=>["simulated","authorized"].includes(i.data.status));
  const otherRevenue=tx.filter(t=>t.data.category==="other_revenue").reduce((s,t)=>s+t.data.amount,0);
  const billed=invoices.reduce((s,i)=>s+i.data.amount,0);
  const received=tx.filter(t=>t.data.category==="revenue").reduce((s,t)=>s+t.data.amount,0);
  const expenses=-tx.filter(t=>expenseCategories.includes(t.data.category)).reduce((s,t)=>s+t.data.amount,0);
  const linked=new Map<string,number>(); records.filter(t=>t.kind==="transaction"&&t.data.category==="revenue"&&t.data.invoiceId).forEach(t=>linked.set(t.data.invoiceId,(linked.get(t.data.invoiceId)||0)+t.data.amount));
  const toReceive=invoices.reduce((s,i)=>s+Math.max(0,i.data.amount-(i.data.issAmount||0)-(linked.get(i.id)||0)),0);
  const unclassified=tx.filter(t=>!t.data.category||t.data.needsReview).length;
  const cashMovement=tx.reduce((s,t)=>s+t.data.amount,0);
  return {otherRevenue,billed,received,expenses,toReceive,unclassified,cashMovement,linked};
}
export function closeGates(company:Company,records:Entry[],period=PERIOD) {
  const p=getPeriod(records,period)?.data||{},tx=inPeriod(records,"transaction",period),docs=inPeriod(records,"document",period);
  const unlinked=tx.filter(t=>t.data.category==="revenue"&&!t.data.invoiceId&&!t.data.justification).length;
  return [
    {id:"matrix",label:"Cadastro e matriz tributária",detail:"Validação do contador responsável",done:company.data.active&&company.data.tax.validated&&!!company.data.tax.confirmedAt},
    {id:"bank",label:"Extratos do mês",detail:"Confirme que todas as contas foram informadas",done:!!p.bankConfirmed&&(tx.length>0||!!p.noMovement)},
    {id:"categories",label:"Classificação e conciliação",detail:`${totals(records,period).unclassified} pendência(s) de classificação • ${unlinked} receita(s) sem vínculo ou justificativa`,done:totals(records,period).unclassified===0&&unlinked===0},
    {id:"invoices",label:"Notas fiscais conferidas",detail:"Resolva os rascunhos ou cancele os que não serão emitidos",done:!inPeriod(records,"invoice",period).some(i=>i.data.status==="draft")},
    {id:"documents",label:"Documentação obrigatória",detail:"Anexe o comprovante / relatório mensal",done:docs.some(d=>d.data.category==="monthly"&&!d.data.archivedAt)},
    {id:"revenue",label:"Confirmação das receitas",detail:"Inclua receitas e notas emitidas fora da plataforma",done:!!p.revenueConfirmed},
  ];
}
export function taxEstimate(company:Company,records:Entry[],period=PERIOD) {
  // Validation slice: full 12-month 2026 history, Annex III, no Fator R/withholding.
  const unsupported=!period.startsWith("2026")||company.data.tax.annex!=="III"||company.data.tax.factorR||!!company.data.tax.activities?.some(a=>a.annex!=="III")||inPeriod(records,"invoice",period).some(r=>r.data.issRetained)||inPeriod(records,"transaction",period).some(r=>r.data.category==="other_revenue");
  const start=new Date(`${period}-01T12:00:00Z`); start.setUTCMonth(start.getUTCMonth()-12);
  const keys=Array.from({length:12},(_,i)=>{const d=new Date(start);d.setUTCMonth(d.getUTCMonth()+i);return d.toISOString().slice(0,7);});
  const history=keys.map(k=>records.find(r=>r.kind==="history"&&r.period===k)?.data.revenue);
  const complete=history.every(n=>typeof n==="number"&&n>=0);const rbt12=history.reduce((s,n)=>s+(n||0),0);
  const tiers=[[18000000,.06,0],[36000000,.112,936000],[72000000,.135,1764000],[180000000,.16,3564000],[360000000,.21,12564000]];
  const tier=tiers.find(t=>rbt12<=t[0]);const ready=!unsupported&&complete&&!!tier&&rbt12>0&&company.data.tax.validated;
  const rate=ready?((rbt12*(tier?.[1]||0)-(tier?.[2]||0))/rbt12):null;
  const t=totals(records,period);const base=company.data.tax.regime==="caixa"?t.received:t.billed;
  return {ready,rbt12,rate,base,estimate:rate===null?null:Math.round(base*rate),reason:unsupported?"Cenário requer motor fiscal ampliado e validação oficial.":!complete?"Histórico dos 12 meses incompleto.":!tier?"Acima do cenário de estimativa desta versão.":"Estimativa local • não é apuração oficial",window:`${keys[0]} a ${keys[11]}`};
}

export type Action = { type:string; [key:string]:any };
export type Change = { upserts:Entry[]; company?:Company; event:string; detail:string; };
export function reduceAction(company:Company,records:Entry[],role:Role,a:Action,now=new Date().toISOString()):Change {
  requireThat(allowed(role,a.type),"Seu perfil não permite esta operação.",403);
  const period=a.period||mesApuracao(new Date(now)); requireThat(/^\d{4}-\d{2}$/.test(period),"Competência inválida.");
  const p=getPeriod(records,period); requireThat(p,"Competência não disponível.");
  const upserts:Entry[]=[];let changedCompany:Company|undefined;
  const entry=(kind:Kind,data:Record<string,any>,id=crypto.randomUUID()):Entry=>({id,kind,period,data});
  const update=(r:Entry,patch:Record<string,any>)=>upserts.push({...r,data:{...r.data,...patch}});
  const select=(id:string,kind:Kind)=>{const r=records.find(r=>r.id===id&&r.kind===kind);requireThat(r,"Registro não encontrado nesta empresa.",404);return r;};
  const open=()=>requireThat(p.data.status==="open","Reabra a competência com o contador antes de alterar a base do fechamento.");
  const invalidate=()=>update(p,{revenueConfirmed:false,bankConfirmed:p.data.bankConfirmed,snapshot:null});
  let detail="";
  switch(a.type) {
    case "classify": {
      open();requireThat(Array.isArray(a.ids)&&a.ids.length>0&&a.ids.length<=500,"Selecione de 1 a 500 lançamentos.");
      requireThat(typeof a.category==="string"&&Object.hasOwn(categoryLabels,a.category),"Categoria inválida.");
      const chosen=[...new Set<string>(a.ids)].map(id=>select(id,"transaction"));requireThat(chosen.every(r=>r.period===period),"Selecione lançamentos desta competência.");
      requireThat(chosen.every(r=>["revenue","other_revenue"].includes(a.category)?r.data.amount>0:expenseCategories.includes(a.category)?r.data.amount<0:true),"A categoria não combina com o sinal dos lançamentos selecionados.");
      let invoice:Entry|undefined;
      if(a.invoiceId){requireThat(chosen.length===1&&a.category==="revenue","Vincule uma receita por vez.");invoice=select(a.invoiceId,"invoice");requireThat(["simulated","authorized"].includes(invoice.data.status),"Nota ainda não emitida ou cancelada.");
        const allocated=records.filter(t=>t.kind==="transaction"&&t.data.category==="revenue"&&t.data.invoiceId===invoice!.id&&!a.ids.includes(t.id)).reduce((s,t)=>s+t.data.amount,0);
        requireThat(allocated+chosen[0].data.amount<=invoice.data.amount-(invoice.data.issAmount||0),"Recebimentos vinculados ultrapassam o valor da nota. Revise o rateio.");
      }
      const previous=chosen.map(r=>({id:r.id,category:r.data.category||null,invoiceId:r.data.invoiceId||null,justification:r.data.justification||null,needsReview:!!r.data.needsReview}));
      chosen.forEach(r=>update(r,{category:a.category,invoiceId:invoice?.id||null,justification:a.justification?textField(a.justification,"Justificativa",500):null,needsReview:false,classifiedAt:now}));
      let ruleId:string|null=null;
      if(a.saveRule){requireThat(chosen.every(r=>r.data.amount<0)&&expenseCategories.includes(a.category),"As regras futuras desta versão são para despesas.");
        const pattern=normalize(textField(a.pattern,"Identificador da despesa",100));requireThat(pattern.length>=6&&!/^(PIX|TED|DOC|DEBITO|PAGAMENTO|TRANSFERENCIA|BOLETO)$/.test(pattern),"Use um identificador específico do fornecedor, não um meio de pagamento.");
        requireThat(chosen.every(r=>normalize(r.data.description).includes(pattern)),"O identificador precisa aparecer em todos os lançamentos selecionados.");
        const old=records.find(r=>r.kind==="rule"&&r.data.pattern===pattern);requireThat(!old,"Já existe uma regra para esse identificador.");
        ruleId=crypto.randomUUID();upserts.push(entry("rule",{pattern,category:a.category,active:true,mode:"suggest",createdAt:now},ruleId));
      }
      update(p,{revenueConfirmed:false,lastBatch:{previous,ruleId,at:now}});detail=`${chosen.length} lançamento(s): ${categoryLabels[a.category]}. ${ruleId?"Regra futura criada com confirmação obrigatória.":""}`;break;
    }
    case "undo_classification": {
      open();const batch=p.data.lastBatch;requireThat(batch?.previous?.length,"Não há lote para desfazer.");
      for(const prev of batch.previous){const r=select(prev.id,"transaction");requireThat(r.data.classifiedAt===batch.at,"Um lançamento foi alterado depois do lote. Revise individualmente.");update(r,{...prev,classifiedAt:null});}
      if(batch.ruleId)update(select(batch.ruleId,"rule"),{active:false});update(p,{lastBatch:null,revenueConfirmed:false});detail="Último lote desfeito; eventual regra criada foi desativada.";break;
    }
    case "rule_toggle": {const r=select(a.id,"rule");update(r,{active:!r.data.active});detail=`Regra ${r.data.pattern}: ${!r.data.active?"ativa":"inativa"}.`;break;}
    case "confirm_check": {
      open();requireThat(["bankConfirmed","revenueConfirmed"].includes(a.check),"Confirmação inválida.");update(p,{[a.check]:!!a.value});detail=`${a.check==="bankConfirmed"?"Extratos completos":"Receitas conferidas"}: ${a.value?"sim":"não"}.`;break;
    }
    case "submit": {
      open();const gates=closeGates(company,records,period);requireThat(gates.every(g=>g.done),"Conclua todas as verificações antes de enviar ao contador.");
      const t=totals(records,period);update(p,{status:"submitted",submittedAt:now,snapshot:{companyVersion:company.version,taxVersion:company.data.tax.version,tax:company.data.tax,billed:t.billed,received:t.received,expenses:t.expenses,sourceRecords:records.filter(r=>r.period===period&&["invoice","transaction","document"].includes(r.kind)),estimate:taxEstimate(company,records,period)}});detail="Competência enviada ao contador com versão da base preservada.";break;
    }
    case "review": {requireThat(role==="accountant","Somente o contador pode revisar.",403);requireThat(p.data.status==="submitted","Envie a competência antes da revisão.");update(p,{status:"reviewed",reviewedAt:now,reviewNote:textField(a.note,"Parecer da revisão",1000)});detail="Contador concluiu a revisão; nenhuma declaração transmitida.";break;}
    case "approve": {requireThat(role==="accountant","Somente o contador pode autorizar.",403);requireThat(p.data.status==="reviewed","Conclua a revisão antes da autorização.");update(p,{status:"approved",approvedAt:now});detail="Base aprovada pelo contador. Transmissão e DAS aguardam integração configurada.";break;}
    case "reopen": {requireThat(role==="accountant","Somente o contador pode reabrir.",403);requireThat(p.data.status!=="open","A competência já está aberta.");detail=`Reabertura: ${textField(a.reason,"Motivo",500)}`;update(p,{status:"open",revenueConfirmed:false,bankConfirmed:false,previousSnapshot:p.data.snapshot,snapshot:null,reviewedAt:null,approvedAt:null,reviewNote:null});break;}
    case "invoice_create": {
      open();requireThat(company.data.active&&company.data.tax.validated,"O contador precisa ativar a empresa e validar a matriz.");
      const amount=parseMoney(a.amount);requireThat(amount>0,"Informe um valor positivo.");requireThat(validDate(a.due),"Vencimento inválido.");
      upserts.push(entry("invoice",{customer:textField(a.customer,"Tomador"),service:textField(a.service,"Descrição do serviço",500),amount,due:a.due,status:"draft",createdAt:now}));invalidate();detail="Rascunho de NFS-e criado.";break;
    }
    case "invoice_simulate": {open();requireThat(company.data.demo,"Simulação disponível somente em empresa fictícia.");const r=select(a.id,"invoice");requireThat(r.period===period&&r.data.status==="draft","Rascunho inválido.");update(r,{status:"simulated",issuedAt:now,number:`DEMO-${r.id.slice(0,6).toUpperCase()}`});invalidate();detail="Emissão simulada para validação. Sem validade fiscal.";break;}
    case "invoice_cancel": {open();const r=select(a.id,"invoice");requireThat(r.period===period&&["draft","simulated"].includes(r.data.status),"Cancelamento oficial requer integração fiscal.");requireThat(!records.some(t=>t.kind==="transaction"&&t.data.invoiceId===r.id),"Desvincule os recebimentos antes de cancelar a nota simulada.");update(r,{status:"canceled"});invalidate();detail="Rascunho ou nota simulada cancelado.";break;}
    case "payable_create": {const amount=parseMoney(a.amount);requireThat(amount>0&&validDate(a.due),"Revise valor e vencimento.");requireThat(expenseCategories.includes(a.category),"Escolha uma categoria de despesa.");upserts.push(entry("payable",{description:textField(a.description,"Descrição"),amount,due:a.due,category:a.category,status:"pending"}));detail="Conta a pagar cadastrada.";break;}
    case "report_payable": {const r=select(a.id,"payable");requireThat(r.data.status==="pending","Pagamento já informado.");update(r,{status:"paid_reported",reportedAt:now});detail="Pagamento informado pelo usuário; ainda sem confirmação bancária.";break;}
    case "request_create": {upserts.push(entry("request",{title:textField(a.title,"Assunto"),description:textField(a.description,"Descrição",2000),type:textField(a.requestType,"Tipo",60),status:"new",createdAt:now}));detail="Nova demanda registrada.";break;}
    case "set_request_status": {const r=select(a.id,"request");requireThat(["in_progress","done"].includes(a.status),"Status inválido.");requireThat(a.status!=="done"||!r.data.quote||r.data.acceptedAt,"Solicite o aceite do orçamento antes de concluir a demanda extra.");update(r,{status:a.status,owner:textField(a.owner||"Contador responsável","Responsável"),due:a.due&&validDate(a.due)?a.due:r.data.due||null});detail=`Demanda ${r.data.title}: ${stateLabels[a.status]}.`;break;}
    case "quote_request": {const r=select(a.id,"request");requireThat(!r.data.acceptedAt,"Orçamento já aceito. Registre uma nova demanda para outro escopo.");const amount=parseMoney(a.amount);requireThat(amount>0,"Valor do orçamento inválido.");update(r,{quote:amount,quoteScope:textField(a.scope,"Escopo do orçamento",1000),status:"quoted"});detail="Orçamento registrado, aguardando aceite do cliente.";break;}
    case "accept_quote": {const r=select(a.id,"request");requireThat(r.data.status==="quoted"&&r.data.quote>0,"Orçamento não disponível.");update(r,{status:"accepted",acceptedAt:now});upserts.push(entry("charge",{description:`Serviço extra: ${r.data.title}`,amount:r.data.quote,due:`${period}-28`,status:"pending",source:"extra",requestId:r.id,provider:"not_connected"}));detail="Aceite registrado; cobrança interna criada, emissão externa pendente.";break;}
    case "create_charge": {const amount=parseMoney(a.amount);requireThat(amount>0&&validDate(a.due),"Revise valor e vencimento.");upserts.push(entry("charge",{description:textField(a.description,"Descrição"),amount,due:a.due,status:"pending",source:"subscription",provider:"not_connected"}));detail="Cobrança interna cadastrada; boleto/Pix não emitidos.";break;}
    case "report_charge": {const r=select(a.id,"charge");requireThat(r.data.status==="pending","Pagamento já informado.");update(r,{status:"paid_reported",reportedAt:now});detail="Cliente informou pagamento da cobrança; confirmação do provedor pendente.";break;}
    case "tax_update": throw new DomainError("Use a matriz por atividades e confirme a solicitação de alteração.");
    case "invite": {requireThat(["owner","finance","issuer","viewer"].includes(a.role),"Perfil inválido.");const email=textField(a.email,"E-mail").toLowerCase();requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),"E-mail inválido.");requireThat(!records.some(r=>r.kind==="invitation"&&r.data.email===email),"Este e-mail já tem um convite preparado.");upserts.push(entry("invitation",{email,role:a.role,status:"prepared",createdAt:now}));detail="Convite preparado. Envio e ativação externos ainda não habilitados.";break;}
    case "ack_document": {const r=select(a.id,"document");update(r,{acknowledgedAt:now});detail=`Ciência expressa registrada para ${r.data.name}.`;break;}
    default: throw new DomainError("Operação indisponível nesta versão.",400);
  }
  // Last update wins when an action changes a period more than once.
  return {upserts:[...new Map(upserts.map(r=>[r.id,r])).values()],company:changedCompany,event:a.type,detail};
}
