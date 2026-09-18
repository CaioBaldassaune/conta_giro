import { type Company, type Entry, PERIOD } from "./domain";
export function demoCompany(id:string,name:string):Company {return {id,name,version:0,data:{demo:true,cnpj:"",email:"financeiro@example.com",phone:"",active:true,tax:{regime:"competencia",annex:"III",municipality:"São Paulo / SP",service:"Serviços administrativos",factorR:false,version:1,validated:true}}};}
export function demoRecords(companyId:string,index=0):Entry[] {
  const out:Entry[]=[];let seq=0;const id=(key:string)=>`${companyId}:${key}`;
  const add=(kind:Entry["kind"],data:Entry["data"],key=`record-${seq++}`,period=PERIOD)=>{const r={id:id(key),kind,period,data};out.push(r);return r;};
  add("period",{status:"open",bankConfirmed:false,revenueConfirmed:false,lastBatch:null},"period");
  const factor=index===0?1:index===1?2:6;
  for(let i=0;i<12;i++){const date=new Date(Date.UTC(2025,7+i,15));const period=date.toISOString().slice(0,7);add("history",{revenue:Math.round((1800000+i*40000)*factor),expenses:Math.round((1000000+i*22000)*factor),source:"Dados fictícios"},`history-${i}`,period);}
  const inv=(key:string,customer:string,value:number,due:string)=>add("invoice",{customer,service:"Serviços prestados no mês",amount:value*factor,due,status:"simulated",number:`DEMO-${key}`,issuedAt:`${PERIOD}-05T12:00:00Z`},key);
  const i1=inv("001","Norte Comércio",920000,`${PERIOD}-10`),i2=inv("002","Clara Soluções",780000,`${PERIOD}-15`),i3=inv("003","Vértice Design",450000,"2026-09-10"),i4=inv("004","Ponto Consultoria",300000,`${PERIOD}-25`);
  const tx=(key:string,date:string,description:string,amount:number,category:string|null,invoiceId:string|null=null)=>add("transaction",{date:`${PERIOD}-${date}`,description,amount:amount*factor,category,invoiceId,account:"Conta principal • demonstração",source:"Demonstração",fitId:key,needsReview:false},key);
  tx("tx1","10","PIX NORTE COMERCIO",920000,"revenue",i1.id);tx("tx2","15","TED CLARA SOLUCOES",780000,"revenue",i2.id);tx("tx3","25","PIX PONTO CONSULTORIA",300000,"revenue",i4.id);
  tx("tx4","05","ALUGUEL ESCRITORIO",-180000,"rent");tx("tx5","10","VIVO EMPRESAS INTERNET",-27900,null);tx("tx6","12","TARIFA PACOTE BANCARIO",-8990,null);tx("tx7","16","LICENCA SOFTWARE GESTAO",-125000,null);tx("tx8","20","CREDITO EMPRESTIMO SOCIO",200000,null);
  add("rule",{pattern:"VIVO EMPRESAS",category:"telecom",active:true,mode:"suggest"},"rule1");
  add("payable",{description:"Internet do escritório",amount:27900*factor,due:"2026-09-10",category:"telecom",status:"pending"},"pay1");
  add("payable",{description:"Aluguel • setembro",amount:180000*factor,due:"2026-09-15",category:"rent",status:"pending"},"pay2");
  add("request",{title:"Atualização do endereço comercial",description:"Gostaria de verificar os documentos e o custo para alterar o endereço da empresa.",type:"Alteração cadastral",status:"new",createdAt:"2026-09-02T14:30:00Z"},"req1");
  add("charge",{description:"Plano ContaGiro • setembro",amount:15000,due:"2026-09-10",status:"pending",source:"subscription",provider:"not_connected"},"charge1");
  return out;
}
