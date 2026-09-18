-- Declaração mensal do Simples (PGDAS-D) transmitida pelo ContaGiro via Integra Contador.
-- situacoes_fiscais guarda o estado atual da competência; declaracoes_pgdas, o histórico
-- (prévias e transmissões), para auditoria e retificação.

alter table public.situacoes_fiscais
  add column pgdas_id_declaracao text,
  add column pgdas_valor_devido bigint check (pgdas_valor_devido >= 0), -- centavos; 0 = sem guia
  add column pgdas_recibo_id uuid references public.documentos (id) on delete restrict;
create index situacoes_fiscais_recibo_idx on public.situacoes_fiscais (pgdas_recibo_id);

create table public.declaracoes_pgdas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  competencia public.competencia_mes not null,
  tipo smallint not null check (tipo in (1, 2)), -- 1 original, 2 retificadora
  transmitida boolean not null,                  -- false = prévia (cálculo sem transmissão)
  receita_interna bigint not null check (receita_interna >= 0),
  atividades jsonb not null,
  valores_devidos jsonb not null,
  total_devido bigint not null check (total_devido >= 0),
  id_declaracao text,
  transmitida_em timestamptz,
  recibo_id uuid references public.documentos (id) on delete restrict,
  declaracao_id uuid references public.documentos (id) on delete restrict,
  solicitado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now()
);
create index declaracoes_pgdas_empresa_idx on public.declaracoes_pgdas (empresa_id, competencia, criado_em desc);
create index declaracoes_pgdas_recibo_idx on public.declaracoes_pgdas (recibo_id);
create index declaracoes_pgdas_declaracao_idx on public.declaracoes_pgdas (declaracao_id);
create index declaracoes_pgdas_solicitado_idx on public.declaracoes_pgdas (solicitado_por);

alter table public.declaracoes_pgdas enable row level security;
-- Leitura pela equipe do escritório; gravação só pelo servidor (service_role), após chamar o SERPRO.
create policy declaracoes_pgdas_leitura on public.declaracoes_pgdas for select to authenticated
  using ((select privado.eh_equipe_empresa(empresa_id)));

-- Painel: expõe o valor devido da última declaração (0 = transmitida sem guia).
drop function public.painel_carteira(text);
create function public.painel_carteira(p_competencia text)
returns table (
  empresa_id uuid, razao_social text, cnpj text, ativa boolean, matriz_confirmada boolean,
  competencia_situacao text, extratos_confirmados boolean, receitas_confirmadas boolean, sem_movimento boolean,
  lancamentos_pendentes integer, receitas_sem_vinculo integer, outras_entradas_pendentes integer, notas_rascunho integer,
  documentos_mes integer, chamados_abertos integer, chamados_aguardando_escritorio integer, chamado_mais_antigo timestamptz,
  tarefas_atrasadas integer, cobrancas_vencidas integer, pgdas_transmitida boolean, das_pago boolean, das_vencimento date,
  caixa_postal_novas integer, situacao_fiscal text, fiscal_atualizado_em timestamptz,
  procuracao_pendente boolean, procuracao_mensagem text, pgdas_valor_devido bigint
) language sql stable security invoker set search_path = '' as $$
  select
    e.id, e.razao_social, e.cnpj, e.ativa,
    exists (select 1 from public.versoes_matriz_tributaria v where v.empresa_id = e.id and v.confirmado_por_email is not null),
    c.situacao, c.extratos_confirmados, c.receitas_confirmadas, c.sem_movimento,
    (select count(*)::int from public.movimentacoes_bancarias m
      where m.empresa_id = e.id and m.competencia = p_competencia and (m.categoria is null or m.precisa_revisao)),
    (select count(*)::int from public.movimentacoes_bancarias m
      where m.empresa_id = e.id and m.competencia = p_competencia and m.categoria = 'receita_servicos'
        and m.nota_fiscal_id is null and m.justificativa is null),
    (select count(*)::int from public.movimentacoes_bancarias m
      where m.empresa_id = e.id and m.competencia = p_competencia and m.categoria = 'outras_entradas' and m.natureza_outras is null),
    (select count(*)::int from public.notas_fiscais n
      where n.empresa_id = e.id and n.competencia = p_competencia and n.situacao = 'rascunho'),
    (select count(*)::int from public.documentos d
      where d.empresa_id = e.id and d.competencia = p_competencia and d.arquivado_em is null),
    (select count(*)::int from public.solicitacoes s where s.empresa_id = e.id and s.situacao <> 'concluida'),
    (select count(*)::int from public.solicitacoes s
      where s.empresa_id = e.id and s.situacao <> 'concluida' and s.aguardando = 'escritorio'),
    (select min(s.criado_em) from public.solicitacoes s where s.empresa_id = e.id and s.situacao <> 'concluida'),
    (select count(*)::int from public.tarefas t
      where t.empresa_id = e.id and t.situacao <> 'concluida' and t.prazo < current_date),
    (select count(*)::int from public.cobrancas b
      where b.empresa_id = e.id and b.situacao = 'pendente' and b.vencimento < current_date),
    f.pgdas_transmitida, f.das_pago, f.das_vencimento, f.caixa_postal_novas, f.situacao_fiscal, f.atualizado_em,
    coalesce(pr.situacao = 'pendente', false), pr.mensagem, f.pgdas_valor_devido
  from public.empresas e
  left join public.competencias c on c.empresa_id = e.id and c.competencia = p_competencia
  left join public.situacoes_fiscais f on f.empresa_id = e.id and f.competencia = p_competencia
  left join public.procuracoes_serpro pr on pr.empresa_id = e.id
  where privado.eh_equipe_escritorio(e.escritorio_id)
  order by e.razao_social;
$$;
revoke all on function public.painel_carteira(text) from public, anon;
grant execute on function public.painel_carteira(text) to authenticated;
