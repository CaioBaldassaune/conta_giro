// Extrato bancário via Open Finance (API de Extratos da TecnoSpeed) — código puro, testável.
//
// Por que existe: substituir a importação manual de OFX/CSV. A cada D+1 o ContaGiro busca as
// movimentações do dia anterior e o cliente só precisa CATEGORIZAR. Para acelerar isso, cada
// movimentação traz a contraparte (quem pagou ou recebeu, com CPF/CNPJ), que é cruzada com os
// cadastros de fornecedores e tomadores da empresa. Sem cadastro, a tela oferece "Cadastrar".
//
// Formato de origem: GET /api/v1/statement/openfinance/{uniqueId} (docs/openfinance/tecnospeed/api.json):
//   transaction.credit[] / transaction.debit[] com amount (texto "100.00"), date, description,
//   transactionId, category e participantPayer / participantReceiver (documentNumber cpf|cnpj).
// "transactionDuplicated" é ignorado de propósito: a própria TecnoSpeed marca como duplicado.

import { normalize, type Entry } from "./domain";

export type ParticipanteTs = { name?: string | null; documentNumber?: { type?: string; value?: string } | null } | null;
export type TransacaoTs = {
  transactionId: string; transactionType?: string; amount: string | number; date: string; description?: string | null;
  name?: string | null; category?: string | null; participantPayer?: ParticipanteTs; participantReceiver?: ParticipanteTs;
};
export type ExtratoTs = {
  statement?: { uniqueId?: string; status?: string; reason?: string; type?: string; dateStart?: string; dateEnd?: string } | null;
  transaction?: { credit?: TransacaoTs[]; debit?: TransacaoTs[] } | null;
};

/** Movimentação normalizada para o ContaGiro (valor em centavos: + entrada, − saída). */
export type MovimentoOf = {
  externalId: string;
  date: string;
  description: string;
  amount: number;
  counterpartName: string | null;
  counterpartDoc: string | null;
  providerCategory: string | null;
};

const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const centavos = (v: string | number) => Math.round(Number(String(v).replace(",", ".")) * 100);

/** Situação do protocolo: a TecnoSpeed processa de forma assíncrona. */
export function situacaoProtocolo(e: ExtratoTs): "processando" | "concluido" | "erro" {
  const s = String(e.statement?.status ?? "").toUpperCase();
  if (s === "SUCCESS") return "concluido";
  if (["ERROR", "FAILED", "FAILURE"].includes(s)) return "erro";
  return "processando";
}

/**
 * Converte o extrato da TecnoSpeed em movimentações. Na entrada (crédito) a contraparte é
 * quem pagou (participantPayer); na saída (débito), quem recebeu (participantReceiver).
 */
export function lerExtratoOpenFinance(e: ExtratoTs): MovimentoOf[] {
  const ler = (t: TransacaoTs, sinal: 1 | -1): MovimentoOf | null => {
    const valor = centavos(t.amount);
    if (!t.transactionId || !/^\d{4}-\d{2}-\d{2}/.test(t.date) || !Number.isFinite(valor) || valor === 0) return null;
    const parte = sinal > 0 ? t.participantPayer : t.participantReceiver;
    const doc = soDigitos(parte?.documentNumber?.value);
    return {
      externalId: String(t.transactionId).slice(0, 120),
      date: t.date.slice(0, 10),
      description: String(t.description || t.name || "Movimentação Open Finance").replace(/\s+/g, " ").trim().slice(0, 300),
      amount: sinal * Math.abs(valor),
      counterpartName: (parte?.name || t.name || "").trim().slice(0, 180) || null,
      counterpartDoc: doc.length === 11 || doc.length === 14 ? doc : null,
      providerCategory: t.category ? String(t.category).slice(0, 80) : null,
    };
  };
  const creditos = (e.transaction?.credit ?? []).map((t) => ler(t, 1));
  const debitos = (e.transaction?.debit ?? []).map((t) => ler(t, -1));
  // Mesmo transactionId repetido na resposta entra uma vez só.
  const vistos = new Set<string>();
  return [...creditos, ...debitos].filter((m): m is MovimentoOf => !!m && !vistos.has(m.externalId) && !!vistos.add(m.externalId));
}

/** Cadastro que corresponde à contraparte: primeiro pelo CPF/CNPJ, depois pelo nome normalizado. */
export function casarContraparte(mov: { counterpartDoc?: string | null; counterpartName?: string | null }, contatos: Entry[]): { contato: Entry; por: "documento" | "nome" } | null {
  const lista = contatos.filter((c) => c.kind === "contact");
  if (mov.counterpartDoc) {
    const porDoc = lista.find((c) => soDigitos(c.data.taxId) === mov.counterpartDoc);
    if (porDoc) return { contato: porDoc, por: "documento" };
  }
  const nome = mov.counterpartName ? normalize(mov.counterpartName) : "";
  if (nome.length >= 4) {
    const porNome = lista.find((c) => normalize(String(c.data.name ?? "")) === nome);
    if (porNome) return { contato: porNome, por: "nome" };
  }
  return null;
}

/**
 * Sugestão de categoria pelo histórico da mesma contraparte: se as últimas movimentações
 * categorizadas dessa contraparte usaram uma única categoria, sugere a mesma. O cliente confirma.
 */
export function sugestaoPorContraparte(mov: { id?: string; amount: number; counterpartDoc?: string | null; counterpartName?: string | null }, registros: Entry[]): string | null {
  const nome = mov.counterpartName ? normalize(mov.counterpartName) : "";
  if (!mov.counterpartDoc && nome.length < 4) return null;
  const mesmas = registros.filter((r) => r.kind === "transaction" && r.id !== mov.id && r.data.category && Math.sign(r.data.amount) === Math.sign(mov.amount)
    && ((mov.counterpartDoc && r.data.counterpartDoc === mov.counterpartDoc) || (!mov.counterpartDoc && nome && normalize(String(r.data.counterpartName ?? "")) === nome)))
    .sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)))
    .slice(0, 5);
  const categorias = new Set(mesmas.map((r) => r.data.category));
  return categorias.size === 1 ? [...categorias][0] : null;
}

/** Dia anterior (D-1) no horário de Brasília, que é o que a busca D+1 solicita. */
export function diaAnterior(agora = new Date()): string {
  return new Date(agora.getTime() - 3 * 3600e3 - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Extrato de EXEMPLO para empresas de demonstração (sem contrato TecnoSpeed): mesmo formato da
 * API, com contrapartes fictícias da Bahia. Os ids são determinísticos por data, então buscar
 * o mesmo dia duas vezes não duplica movimentações.
 */
export function extratoDeExemplo(data: string): ExtratoTs {
  const p = (name: string, doc: string): ParticipanteTs => ({ name, documentNumber: { type: doc.length === 14 ? "cnpj" : "cpf", value: doc } });
  const empresa = p("Cliente Amostra Serviços Administrativos Ltda", "11222333000181");
  const id = (n: number) => `exemplo-${data}-${n}`;
  return {
    statement: { uniqueId: `exemplo-${data}`, status: "SUCCESS", reason: "Extrato de exemplo (demonstração)", type: "BANK", dateStart: data, dateEnd: data },
    transaction: {
      credit: [
        { transactionId: id(1), amount: "4800.00", date: data, description: "PIX RECEBIDO AGRO OESTE COMERCIO", category: "Transfer - PIX", participantPayer: p("Agro Oeste Comércio de Insumos Ltda", "10000001000190"), participantReceiver: empresa },
        { transactionId: id(2), amount: "1250.00", date: data, description: "TED RECEBIDA TRANSPORTES CHAPADA", category: "Transfer - TED", participantPayer: p("Transportes Chapada Diamantina Ltda", "10000002000134"), participantReceiver: empresa },
        { transactionId: id(3), amount: "300.00", date: data, description: "PIX RECEBIDO MARIA S OLIVEIRA", category: "Transfer - PIX", participantPayer: p("Maria Santos Oliveira", "52998224725"), participantReceiver: empresa },
      ],
      debit: [
        { transactionId: id(4), amount: "2200.00", date: data, description: "PAGTO BOLETO IMOBILIARIA LEM", category: "Rent", participantPayer: empresa, participantReceiver: p("Imobiliária Luís Eduardo Magalhães Ltda", "10000003000189") },
        { transactionId: id(5), amount: "389.90", date: data, description: "DEB AUTOMATICO ENERGIA OESTE", category: "Utilities", participantPayer: empresa, participantReceiver: p("Energia Oeste Distribuidora (exemplo)", "10000004000123") },
        { transactionId: id(6), amount: "129.90", date: data, description: "PAGTO FIBRA OESTE INTERNET", category: "Telecommunications", participantPayer: empresa, participantReceiver: p("Fibra Oeste Telecomunicações Ltda", "10000005000178") },
        { transactionId: id(7), amount: "59.00", date: data, description: "ASSINATURA SOFTWARE GESTAO", category: "Digital services", participantPayer: empresa, participantReceiver: p("Nuvem Gestão Software Ltda", "11444777000161") },
        { transactionId: id(8), amount: "18.50", date: data, description: "TARIFA PACOTE SERVICOS", category: "Bank fees", participantPayer: empresa, participantReceiver: null },
      ],
    },
  };
}
