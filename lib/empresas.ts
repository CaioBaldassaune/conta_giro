// Cadastro de empresa pela equipe do escritório (painel). A empresa nasce com o mês de apuração
// (anterior) e o mês corrente abertos. O autocadastro do cliente fica em app/api/onboarding.
import { requireThat, mesApuracao, mesAtual, type Company, type Entry } from "./domain";
import { demoCompany, demoRecords } from "./seed";
import { erroDoBanco, gravarAlteracoes, type EmpresaCarregada } from "./repositorio";
import type { ClienteSupabase } from "./supabase/servidor";

type NovaEmpresa = { razaoSocial: string; cnpj?: string; municipio?: string; email?: string };

/**
 * Cria uma empresa na carteira do escritório com a competência inicial aberta e o
 * cadastro tributário inicial (ainda sem confirmação do contador).
 * Com `demonstracao`, inclui os lançamentos fictícios da versão original.
 */
export async function criarEmpresa(sb: ClienteSupabase, usuarioId: string, escritorioId: string, dados: NovaEmpresa, demonstracao?: number) {
  const razaoSocial = dados.razaoSocial.trim();
  requireThat(razaoSocial.length >= 2 && razaoSocial.length <= 180, "Informe a razão social (2 a 180 caracteres).");
  const cnpj = (dados.cnpj ?? "").replace(/\D/g, "");
  requireThat(!cnpj || cnpj.length === 14, "CNPJ deve ter 14 dígitos.");
  const municipio = (dados.municipio ?? "").trim() || "São Paulo / SP";

  // O id é gerado aqui: ler a linha de volta no mesmo INSERT (returning) esbarraria
  // na política de leitura, que ainda não enxerga a empresa recém-criada.
  const empresa = { id: crypto.randomUUID() };
  const { error } = await sb.from("empresas").insert({
    id: empresa.id, escritorio_id: escritorioId, razao_social: razaoSocial, cnpj: cnpj || null, municipio,
    email: dados.email || null, demonstracao: demonstracao !== undefined,
  });
  if (error) throw erroDoBanco(error);

  const base: Company = demoCompany(empresa.id, razaoSocial);
  base.data.tax.municipality = municipio;
  const agora = new Date().toISOString();
  const apuracao = mesApuracao(), corrente = mesAtual();
  const cadastroInicial: Entry = {
    id: crypto.randomUUID(), kind: "tax_version", period: apuracao,
    data: { before: null, after: { ...base.data.tax, version: 1, effectiveFrom: apuracao, activities: [] }, requestId: null, confirmedBy: null, confirmedAt: agora },
  };
  const registros = demonstracao !== undefined
    ? demoRecords(empresa.id, demonstracao)
    : [apuracao, corrente].map((period) => ({ id: crypto.randomUUID(), kind: "period" as const, period, data: { status: "open", bankConfirmed: false, revenueConfirmed: false, lastBatch: null } }));

  const vazia: EmpresaCarregada = { company: { ...base, version: 0 }, records: [], escritorioId, atividades: new Map() };
  await gravarAlteracoes(sb, vazia, usuarioId, {
    upserts: [cadastroInicial, ...registros],
    event: "empresa_criada",
    detail: `${razaoSocial} incluída na carteira${demonstracao !== undefined ? " com dados fictícios de demonstração" : ""}.`,
  });
  return empresa.id as string;
}

export const EMPRESAS_DEMONSTRACAO = ["Aurora Serviços Administrativos", "Estúdio Horizonte", "Prisma Engenharia"];
