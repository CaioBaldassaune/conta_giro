import { DomainError, normalize, parseMoney, requireThat, validDate, type Entry } from "./domain";
export type ImportedRow={date:string;description:string;amount:number;fitId:string|null;line:number;possibleDuplicate:boolean};
function parseDate(v:string):string {const s=v.trim();let result="";if(/^\d{8}/.test(s))result=`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;else if(/^\d{2}\/\d{2}\/\d{4}$/.test(s))result=s.split("/").reverse().join("-");else result=s;requireThat(validDate(result),`Data inválida: ${s.slice(0,30)}.`);return result;}
function csvRows(content:string):string[][] {
  const first=content.split(/\r?\n/)[0];const separator=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?";":",";
  const rows:string[][]=[];let row:string[]=[],cell="",quoted=false;
  for(let i=0;i<content.length;i++){const ch=content[i];if(ch==='"'){if(quoted&&content[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(ch===separator&&!quoted){row.push(cell);cell="";}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&content[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell="";}
    else cell+=ch;
  } requireThat(!quoted,"CSV com aspas não fechadas.");row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
export function parseStatement(content:string,name:string):ImportedRow[] {
  requireThat(content.length<=2_000_000,"Importe arquivos de até 2 MB.");content=content.replace(/^\uFEFF/,"");let result:ImportedRow[]=[];
  if(/\.ofx$/i.test(name)||/<OFX[>\s]/i.test(content)){
    const blocks=content.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi)||[];requireThat(blocks.length>0,"Nenhum lançamento encontrado no OFX.");
    const tag=(s:string,t:string)=>s.match(new RegExp(`<${t}>([^<\\r\\n]+)`,"i"))?.[1]?.trim()||"";
    result=blocks.map((b,i)=>{const raw=tag(b,"TRNAMT");requireThat(/^-?\d+(\.\d{1,2})?$/.test(raw),`Valor OFX inválido no lançamento ${i+1}.`);return {date:parseDate(tag(b,"DTPOSTED")),description:(tag(b,"MEMO")||tag(b,"NAME")||"Movimentação bancária").slice(0,300),amount:Math.round(Number(raw)*100),fitId:tag(b,"FITID")||null,line:i+1,possibleDuplicate:false};});
  }else{
    const rows=csvRows(content);requireThat(rows.length>=2,"O CSV precisa de cabeçalho e lançamentos.");const head=rows.shift()!.map(normalize);
    const idx=(aliases:string[])=>head.findIndex(h=>aliases.includes(h));const d=idx(["DATA","DATE","DATA LANCAMENTO"]),description=idx(["DESCRICAO","HISTORICO","DESCRIPTION","MEMO"]),amount=idx(["VALOR","AMOUNT"]),id=idx(["ID","FITID","IDENTIFICADOR"]);
    requireThat(d>=0&&description>=0&&amount>=0,"Use as colunas Data, Descrição e Valor. A coluna ID é opcional. Baixe o modelo disponível.");
    result=rows.map((r,i)=>{try{return {date:parseDate(r[d]||""),description:(r[description]||"").trim().slice(0,300),amount:parseMoney(r[amount]),fitId:id>=0?r[id]?.trim()||null:null,line:i+2,possibleDuplicate:false};}catch(e){throw new DomainError(`Linha ${i+2}: ${(e as Error).message}`);}});
  }
  requireThat(result.length<=500,"Importe até 500 lançamentos por arquivo.");requireThat(result.every(r=>r.description&&Number.isSafeInteger(r.amount)&&r.amount!==0),"Há descrição vazia ou valor zero/inválido no arquivo.");
  const counts=new Map<string,number>();result.forEach(r=>{const k=`${r.date}|${r.amount}|${normalize(r.description)}`;counts.set(k,(counts.get(k)||0)+1);});
  return result.map(r=>({...r,possibleDuplicate:!r.fitId&&(counts.get(`${r.date}|${r.amount}|${normalize(r.description)}`)||0)>1}));
}
export function suggestedCategory(row:{description:string;amount:number},records:Entry[]):{category:string;pattern:string}|null {
  if(row.amount>=0)return null;
  const rules=records.filter(r=>r.kind==="rule"&&r.data.active&&normalize(row.description).includes(r.data.pattern));
  if(!rules.length||new Set(rules.map(r=>r.data.category)).size!==1)return null;
  return {category:rules[0].data.category,pattern:rules[0].data.pattern};
}
