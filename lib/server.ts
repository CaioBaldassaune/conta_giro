// Camada de servidor das rotas /api: identifica o usuário (Supabase Auth), descobre o papel dele
// na empresa pelos VÍNCULOS NO BANCO (nunca pelo portal pedido), carrega os dados e grava com
// retentativa em conflito de versão. getState() monta o estado da tela do portal.
// Regra de acesso: equipe do escritório = contador (vê a carteira toda e pode abrir a visão do
// cliente); membro da empresa = cliente (sócio, financeiro, emissor ou consulta) e só vê a própria.
import { criarClienteServidor, type ClienteSupabase } from "@/lib/supabase/servidor";
import { DomainError, mesApuracao, mesAtual, requireThat, visibleKinds, type Audit, type Change, type Entry, type Role, type WorkspaceState } from "./domain";
import { carregarEmpresas, ConflitoDeVersao, gravarAlteracoes, type EmpresaCarregada } from "./repositorio";
import { PAPEIS } from "./traducao";

export type Portal = "contador" | "cliente";

/** Portal da requisição: parâmetro explícito ou a página que fez a chamada (Referer). */
export function portalDe(request: Request, explicito?: unknown): Portal {
  if (explicito === "cliente" || explicito === "contador") return explicito;
  const origem = request.headers.get("referer") ?? "";
  try {
    return new URL(origem).pathname.startsWith("/cliente") ? "cliente" : "contador";
  } catch {
    return "contador";
  }
}

export async function identity() {
  const sb = await criarClienteServidor();
  const { data: { user } } = await sb.auth.getUser();
  requireThat(user, "Entre com sua conta para acessar o portal.", 401);
  const nome = (user.user_metadata?.nome as string | undefined) || user.email || "Usuário";
  return { sb, u: { id: user.id, email: user.email ?? "", displayName: nome } };
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin"), site = new URL(request.url);
  requireThat(origin && new URL(origin).host === site.host, "Origem da solicitação inválida.", 403);
}

export function fail(e: unknown) {
  const status = e instanceof DomainError ? e.status : 500;
  if (!(e instanceof DomainError)) console.error(e);
  return Response.json(
    { error: e instanceof DomainError ? e.message : "Não foi possível concluir. Nenhuma confirmação de sucesso foi registrada. Tente novamente." },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** Escritórios em que o usuário é equipe e empresas em que é usuário do cliente. */
export async function acessos(sb: ClienteSupabase, usuarioId: string) {
  const [equipe, cliente] = await Promise.all([
    sb.from("membros_escritorio").select("escritorio_id, papel").eq("usuario_id", usuarioId),
    sb.from("membros_empresa").select("empresa_id, papel").eq("usuario_id", usuarioId),
  ]);
  return {
    escritorios: (equipe.data ?? []).map((m) => m.escritorio_id as string),
    empresasCliente: new Map((cliente.data ?? []).map((m) => [m.empresa_id as string, m.papel as string])),
  };
}

async function papelNaEmpresa(sb: ClienteSupabase, usuarioId: string, empresa: EmpresaCarregada): Promise<Role | null> {
  const a = await acessos(sb, usuarioId);
  if (a.escritorios.includes(empresa.escritorioId)) return "accountant";
  const papel = a.empresasCliente.get(empresa.company.id);
  return papel ? (PAPEIS.regra(papel) as Role) : null;
}

export async function context(companyId: string) {
  requireThat(typeof companyId === "string" && companyId, "Escolha uma empresa.");
  const { sb, u } = await identity();
  const empresa = (await carregarEmpresas(sb, [companyId])).get(companyId);
  requireThat(empresa, "Empresa não disponível para este acesso.", 404);
  const role = await papelNaEmpresa(sb, u.id, empresa);
  requireThat(role, "Empresa não disponível para este acesso.", 404);
  return { sb, u, empresa, company: empresa.company, records: empresa.records, role, escritorioId: empresa.escritorioId };
}
export type Contexto = Awaited<ReturnType<typeof context>>;

export async function persist(ctx: Contexto, change: Change) {
  await gravarAlteracoes(ctx.sb, ctx.empresa, ctx.u.id, change);
}

/**
 * Executa carregar → aplicar regra → gravar. Se outra pessoa gravou na mesma
 * empresa no meio do caminho, recarrega e reaplica a regra sobre os dados novos
 * (em vez de devolver erro ao usuário). Desiste após 3 tentativas.
 */
export async function comRetentativa<T>(operacao: () => Promise<T>): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await operacao();
    } catch (e) {
      if (!(e instanceof ConflitoDeVersao) || tentativa >= 3) throw e;
    }
  }
}

// Regras de visibilidade herdadas da versão anterior (o RLS já filtra por papel;
// aqui também se reduzem campos que alguns perfis não precisam ver).
function filtrarParaPapel(records: Entry[], role: Role): Entry[] {
  const kindSet = visibleKinds(role);
  const visibleDocIds = new Set(records.filter((r) => r.kind === "document" && (role !== "issuer" || r.data.category === "invoice")
    && (r.data.category !== "people" || ["owner", "accountant"].includes(role))).map((r) => r.id));
  return records
    .filter((r) => kindSet.includes(r.kind)
      && (r.kind !== "document_event" || visibleDocIds.has(r.data.documentId))
      && (!["employee", "payroll"].includes(r.kind) || ["owner", "accountant"].includes(role))
      && (!["lead", "task", "accounting", "journal", "tax_version"].includes(r.kind) || role === "accountant")
      && (r.kind !== "document" || visibleDocIds.has(r.id))
      && (role !== "issuer" || r.kind !== "contact" || ["customer", "both"].includes(r.data.contactType)))
    .map((r) => role === "issuer" && r.kind === "period" ? { ...r, data: { status: r.data.status } }
      : !["owner", "accountant"].includes(role) && r.kind === "period"
        ? { ...r, data: { status: r.data.status, bankConfirmed: r.data.bankConfirmed, revenueConfirmed: r.data.revenueConfirmed, noMovement: r.data.noMovement, lastBatch: r.data.lastBatch } }
        : r);
}

export class SemAcesso extends DomainError {
  constructor(public motivo: "sem_escritorio" | "sem_empresa" | "sem_convite") {
    super(motivo === "sem_convite" ? "Seu acesso ao portal do cliente depende de um convite do escritório." : "Cadastre o escritório e a primeira empresa para começar.", 403);
  }
}

/**
 * Estado da tela. Por padrão carrega só a empresa selecionada (escala para 100+
 * empresas); `carteira: true` carrega todas, apenas para as telas que precisam.
 */
export async function getState(portal: Portal, companyId?: string, period = mesApuracao(), opcoes: { carteira?: boolean } = {}): Promise<WorkspaceState> {
  const { sb, u } = await identity();
  const a = await acessos(sb, u.id);

  let ids: string[];
  if (portal === "contador") {
    if (!a.escritorios.length) throw new SemAcesso("sem_escritorio");
    const { data } = await sb.from("empresas").select("id").in("escritorio_id", a.escritorios).order("razao_social");
    ids = (data ?? []).map((e) => e.id as string);
    if (!ids.length) throw new SemAcesso("sem_empresa");
  } else {
    ids = [...a.empresasCliente.keys()];
    // O contador pode abrir o portal do cliente (visão do cliente de qualquer empresa da carteira).
    if (!ids.length && a.escritorios.length) {
      const { data } = await sb.from("empresas").select("id").in("escritorio_id", a.escritorios).order("razao_social");
      ids = (data ?? []).map((e) => e.id as string);
    }
    if (!ids.length) throw new SemAcesso("sem_convite");
  }

  const selected = companyId && ids.includes(companyId) ? companyId : ids[0];
  // O papel vem do vínculo no banco (nunca do portal pedido): equipe do escritório = contador.
  const role: Role = portal === "contador" || !a.empresasCliente.has(selected) ? "accountant" : (PAPEIS.regra(a.empresasCliente.get(selected)) as Role);
  const comCarteira = portal === "contador" && !!opcoes.carteira;
  const carregadas = await carregarEmpresas(sb, comCarteira ? ids : [selected]);
  const atual = carregadas.get(selected);
  requireThat(atual, "Empresa indisponível.", 404);

  // Demais empresas vêm só com nome e versão (o seletor de empresa não precisa de mais).
  const companies = comCarteira
    ? ids.map((id) => carregadas.get(id)!.company).filter(Boolean)
    : (await sb.from("empresas").select("id, razao_social, versao, ativa, cnpj, demonstracao").in("id", ids).order("razao_social")).data!
        .map((e) => e.id === selected ? atual.company : {
          id: e.id, name: e.razao_social, version: e.versao,
          data: { demo: e.demonstracao, cnpj: e.cnpj ?? "", email: "", phone: "", active: e.ativa,
            tax: { regime: "competencia" as const, annex: "III" as const, municipality: "", service: "", factorR: false, version: 0, validated: false } },
        });

  let audit: Audit[] = [];
  if (role === "accountant" || role === "owner") {
    const { data } = await sb.from("registros_auditoria").select("id, ator_email, acao, detalhe, criado_em")
      .eq("empresa_id", selected).order("criado_em", { ascending: false }).limit(60);
    audit = (data ?? []).map((r) => ({ id: String(r.id), actor_email: r.ator_email, action: r.acao, detail: r.detalhe, created_at: r.criado_em }));
  }

  const available = atual.records.filter((r) => r.kind === "period").map((r) => r.period);
  const padrao = available.includes(mesApuracao()) ? mesApuracao() : available.filter((m) => m <= mesAtual()).sort().at(-1);
  const selectedPeriod = available.includes(period) ? period : padrao || available.sort().at(-1) || mesApuracao();

  return {
    period: selectedPeriod,
    portfolio: comCarteira ? ids.map((id) => ({ company: carregadas.get(id)!.company, records: carregadas.get(id)!.records })) : undefined,
    companies,
    records: filtrarParaPapel(atual.records, role),
    selectedCompany: selected,
    audit,
    user: { name: u.displayName, email: u.email, role },
  };
}
