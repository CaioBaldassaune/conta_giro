// Orquestra o extrato Open Finance de uma empresa: conexão da conta, busca D+1 e importação.
//
// Decisões:
// - A busca pede o período pendente até ONTEM (D-1, Brasília): da última data importada + 1 até
//   D-1 (na primeira vez, desde o início do mês em apuração, limitado a 62 dias). Assim, se
//   ninguém abrir o app por alguns dias, nada se perde.
// - Deduplicação pelo transactionId do provedor (id_externo único por conta no banco).
// - Empresas de demonstração usam o extrato de exemplo (mesmo formato), sem chamar a TecnoSpeed.
// - A sincronização roda quando alguém da empresa abre a tela de Movimentações (D+1 automático
//   em homologação, onde o cron da Vercel não roda) ou pelo botão "Sincronizar agora".

import "server-only";
import { mesApuracao, normalize, requireThat, type Entry } from "./domain";
import { diaAnterior, extratoDeExemplo, lerExtratoOpenFinance, situacaoProtocolo, type MovimentoOf } from "./openfinance";
import { carregarCredenciaisOf, consultarConta, consultarProtocolo, gerarProtocolo } from "./openfinance-tecnospeed";
import { comRetentativa, context, persist, type Contexto } from "./server";
import type { ClienteAdmin } from "./supabase/admin";
import { idBanco } from "./traducao";

export const PAPEIS_EXTRATO = ["accountant", "owner", "finance"];

export const nomeDaConta = (banco: string, agencia: string, conta: string) => `Banco ${banco} • Ag ${agencia} • Cc ${conta}`.slice(0, 80);
export const NOME_CONTA_DEMONSTRACAO = "Conta de demonstração (Open Finance)";
export const idContaBancaria = (empresaId: string, nome: string) => idBanco(`${empresaId}:conta:${normalize(nome)}`);

const somarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Período a buscar: do dia seguinte ao último importado até D-1 (máximo de 62 dias). */
export function periodoPendente(ultimoDia: string | null, hoje = new Date()): { inicio: string; fim: string } | null {
  const fim = diaAnterior(hoje);
  let inicio = ultimoDia ? somarDias(ultimoDia, 1) : `${mesApuracao(hoje)}-01`;
  if (inicio > fim) return null;
  if (somarDias(inicio, 62) < fim) inicio = somarDias(fim, -61);
  return { inicio, fim };
}

/**
 * Grava as movimentações novas como lançamentos a categorizar. Abre a competência se ainda
 * não existir e avisa o cliente no portal. Devolve quantas entraram e quantas já existiam.
 */
export async function importarMovimentos(empresaId: string, contaNome: string, movimentos: MovimentoOf[], origem: string) {
  return comRetentativa(async () => {
    const ctx = await context(empresaId);
    const existentes = new Set(ctx.records.filter((r) => r.kind === "transaction" && r.data.externalId).map((r) => `${normalize(String(r.data.account))}|${r.data.externalId}`));
    const novos = movimentos.filter((m) => !existentes.has(`${normalize(contaNome)}|${m.externalId}`));
    if (!novos.length) return { importados: 0, repetidos: movimentos.length };

    const competencias = [...new Set(novos.map((m) => m.date.slice(0, 7)))];
    const abertas = new Set(ctx.records.filter((r) => r.kind === "period").map((r) => r.period));
    const agora = new Date().toISOString();
    const entradas: Entry[] = [
      ...competencias.filter((c) => !abertas.has(c)).map((c) => ({ id: crypto.randomUUID(), kind: "period" as const, period: c, data: { status: "open", bankConfirmed: false, revenueConfirmed: false, lastBatch: null } })),
      ...novos.map((m) => ({
        id: crypto.randomUUID(), kind: "transaction" as const, period: m.date.slice(0, 7),
        data: {
          date: m.date, description: m.description, amount: m.amount, category: null, invoiceId: null, account: contaNome,
          source: origem.slice(0, 180), fileHash: null, fitId: null, needsReview: false,
          origin: "openfinance", externalId: m.externalId, counterpartName: m.counterpartName, counterpartDoc: m.counterpartDoc, providerCategory: m.providerCategory,
        },
      })),
    ];
    const dias = [...new Set(novos.map((m) => m.date))].sort();
    entradas.push({
      id: crypto.randomUUID(), kind: "notification", period: novos[0].date.slice(0, 7),
      data: {
        title: `${novos.length} movimentação(ões) para categorizar`,
        body: `O extrato de ${dias.length === 1 ? dias[0].split("-").reverse().join("/") : `${dias[0].split("-").reverse().join("/")} a ${dias.at(-1)!.split("-").reverse().join("/")}`} chegou pelo Open Finance. Categorize as receitas e despesas em Movimentações.`,
        createdAt: agora, audience: "client", readBy: [], channel: "portal",
      },
    });
    await persist(ctx, { upserts: entradas, event: "extrato_openfinance", detail: `${novos.length} movimentação(ões) importada(s) do Open Finance (${contaNome}).` });
    return { importados: novos.length, repetidos: movimentos.length - novos.length };
  });
}

type ContaOf = { id: string; nome: string; openfinance_account_hash: string | null; openfinance_situacao: string; openfinance_ultimo_dia: string | null };

/** Busca e importa o extrato pendente de todas as contas conectadas da empresa. */
export async function sincronizarEmpresa(admin: ClienteAdmin, ctx: Contexto) {
  requireThat(PAPEIS_EXTRATO.includes(ctx.role), "Seu perfil não busca o extrato bancário.", 403);
  const { data: contas } = await admin.from("contas_bancarias")
    .select("id, nome, openfinance_account_hash, openfinance_situacao, openfinance_ultimo_dia")
    .eq("empresa_id", ctx.company.id).not("openfinance_situacao", "is", null);
  const resumo = { importados: 0, avisos: [] as string[] };
  for (const conta of (contas ?? []) as ContaOf[]) {
    try {
      const r = await sincronizarConta(admin, ctx, conta);
      resumo.importados += r.importados;
      if (r.aviso) resumo.avisos.push(`${conta.nome}: ${r.aviso}`);
    } catch (e) {
      resumo.avisos.push(`${conta.nome}: ${(e as Error).message}`);
    }
  }
  return resumo;
}

async function sincronizarConta(admin: ClienteAdmin, ctx: Contexto, conta: ContaOf): Promise<{ importados: number; aviso?: string }> {
  const periodo = periodoPendente(conta.openfinance_ultimo_dia);
  const concluir = (dia: string) => admin.from("contas_bancarias").update({ openfinance_ultimo_dia: dia }).eq("id", conta.id);

  if (conta.openfinance_situacao === "demonstracao") {
    if (!periodo) return { importados: 0 };
    // Demonstração: um extrato de exemplo por dia pendente (no máximo os 5 últimos).
    const dias: string[] = [];
    for (let d = periodo.fim; d >= periodo.inicio && dias.length < 5; d = somarDias(d, -1)) dias.push(d);
    const movimentos = dias.flatMap((d) => lerExtratoOpenFinance(extratoDeExemplo(d)));
    const r = await importarMovimentos(ctx.company.id, conta.nome, movimentos, "Open Finance (extrato de exemplo)");
    await concluir(periodo.fim);
    return { importados: r.importados };
  }

  const cred = await carregarCredenciaisOf(admin, ctx.escritorioId);
  const cnpj = ctx.company.data.cnpj;
  requireThat(cnpj && conta.openfinance_account_hash, "Conta sem cadastro na TecnoSpeed.");

  if (conta.openfinance_situacao === "aguardando_consentimento") {
    const c = await consultarConta(cred, cnpj, conta.openfinance_account_hash);
    if (!c.openfinanceId) return { importados: 0, aviso: "aguardando a autorização no banco (abra o link de consentimento)." };
    await admin.from("contas_bancarias").update({ openfinance_id: c.openfinanceId, openfinance_situacao: "conectada" }).eq("id", conta.id);
  }

  // Protocolo em processamento de uma chamada anterior: consulta antes de pedir outro (limite de 1 a cada 6 h).
  const { data: pendente } = await admin.from("protocolos_extrato").select("id, unique_id, data_fim")
    .eq("conta_bancaria_id", conta.id).eq("situacao", "processando").order("criado_em", { ascending: false }).limit(1).maybeSingle();
  let protocolo = pendente as { id: string; unique_id: string; data_fim: string } | null;
  if (!protocolo) {
    if (!periodo) return { importados: 0 };
    const uniqueId = await gerarProtocolo(cred, cnpj, conta.openfinance_account_hash, periodo.inicio, periodo.fim);
    const { data } = await admin.from("protocolos_extrato").insert({
      empresa_id: ctx.company.id, conta_bancaria_id: conta.id, unique_id: uniqueId, data_inicio: periodo.inicio, data_fim: periodo.fim, solicitado_por: ctx.u.id,
    }).select("id, unique_id, data_fim").single();
    protocolo = data;
    await new Promise((r) => setTimeout(r, 15_000)); // a TecnoSpeed processa de forma assíncrona
  }
  if (!protocolo) return { importados: 0, aviso: "não foi possível registrar o protocolo." };

  const extrato = await consultarProtocolo(cred, cnpj, protocolo.unique_id);
  const situacao = situacaoProtocolo(extrato);
  if (situacao === "processando") return { importados: 0, aviso: "extrato ainda em processamento no banco; tente de novo em alguns minutos." };
  if (situacao === "erro") {
    await admin.from("protocolos_extrato").update({ situacao: "erro", mensagem: extrato.statement?.reason ?? null, concluido_em: new Date().toISOString() }).eq("id", protocolo.id);
    return { importados: 0, aviso: `o banco não devolveu o extrato (${extrato.statement?.reason ?? "sem motivo informado"}).` };
  }
  const movimentos = lerExtratoOpenFinance(extrato);
  const r = await importarMovimentos(ctx.company.id, conta.nome, movimentos, `Open Finance (protocolo ${protocolo.unique_id})`);
  await admin.from("protocolos_extrato").update({ situacao: "concluido", mensagem: extrato.statement?.reason ?? null, movimentos: movimentos.length, importados: r.importados, concluido_em: new Date().toISOString() }).eq("id", protocolo.id);
  await concluir(protocolo.data_fim);
  return { importados: r.importados };
}
