-- ContaGiro • Visão macro do contador (100+ empresas) e central de chamados.
--
-- 1. Chamados: as solicitações ganham prioridade, responsável e conversa.
-- 2. situacoes_fiscais: status vindos do SERPRO Integra Contador (PGDAS-D, DAS,
--    Caixa Postal, Situação Fiscal). Preenchida pela integração; o painel já lê.
-- 3. painel_carteira(): uma linha por empresa, calculada no banco, respeitando o RLS.

-- ---------------------------------------------------------------------------
-- Chamados
-- ---------------------------------------------------------------------------
alter table public.solicitacoes
  add column prioridade text not null default 'normal' check (prioridade in ('baixa', 'normal', 'alta', 'urgente')),
  add column responsavel_id uuid references auth.users (id) on delete set null,
  add column aguardando text not null default 'escritorio' check (aguardando in ('escritorio', 'cliente')),
  add column ultima_interacao_em timestamptz not null default now();
create index solicitacoes_responsavel_idx on public.solicitacoes (responsavel_id);
create index solicitacoes_fila_idx on public.solicitacoes (situacao, ultima_interacao_em desc);

create table public.mensagens_chamado (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes (id) on delete restrict,
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  autor_id uuid references auth.users (id) on delete set null,
  autor_email text not null,
  autor_nome text not null default '',
  lado text not null check (lado in ('escritorio', 'cliente')),
  corpo text not null check (length(trim(corpo)) between 1 and 4000),
  criado_em timestamptz not null default now()
);
create index mensagens_chamado_solicitacao_idx on public.mensagens_chamado (solicitacao_id, criado_em);
create index mensagens_chamado_empresa_idx on public.mensagens_chamado (empresa_id);
create index mensagens_chamado_autor_idx on public.mensagens_chamado (autor_id);
comment on table public.mensagens_chamado is 'Conversa de cada chamado; somente inclusão.';

alter table public.mensagens_chamado enable row level security;
create policy mensagens_chamado_ver on public.mensagens_chamado for select to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro', 'consulta'));
create policy mensagens_chamado_incluir on public.mensagens_chamado for insert to authenticated with check (
  autor_id = (select auth.uid())
  and exists (select 1 from public.solicitacoes s where s.id = solicitacao_id and s.empresa_id = mensagens_chamado.empresa_id)
  and (
    (lado = 'escritorio' and privado.eh_equipe_empresa(empresa_id))
    or (lado = 'cliente' and privado.papel_em(empresa_id, 'socio', 'financeiro'))
  )
);

-- Cada mensagem atualiza "com quem está a bola" e a data da última interação.
create or replace function privado.ao_registrar_mensagem()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.solicitacoes
  set ultima_interacao_em = new.criado_em,
      aguardando = case when new.lado = 'escritorio' then 'cliente' else 'escritorio' end,
      situacao = case when new.lado = 'cliente' and situacao = 'concluida' then 'em_atendimento' else situacao end
  where id = new.solicitacao_id;
  return new;
end $$;
create trigger mensagens_chamado_interacao after insert on public.mensagens_chamado
  for each row execute function privado.ao_registrar_mensagem();

-- ---------------------------------------------------------------------------
-- Status fiscais vindos do SERPRO (um registro por empresa e competência)
-- ---------------------------------------------------------------------------
create table public.situacoes_fiscais (
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  competencia public.competencia_mes not null,
  pgdas_transmitida boolean,
  pgdas_transmitida_em timestamptz,
  das_valor bigint,
  das_vencimento date,
  das_pago boolean,
  das_pago_em date,
  caixa_postal_novas integer,
  situacao_fiscal text check (situacao_fiscal in ('regular', 'pendencias', 'indisponivel')),
  situacao_fiscal_documento_id uuid references public.documentos (id) on delete restrict,
  fonte text not null default 'serpro_integra_contador',
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, competencia)
);
create index situacoes_fiscais_documento_idx on public.situacoes_fiscais (situacao_fiscal_documento_id);
alter table public.situacoes_fiscais enable row level security;
create policy situacoes_fiscais_ver on public.situacoes_fiscais for select to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio'));
-- Gravação apenas pelo servidor (service_role), a partir das respostas do SERPRO.

-- ---------------------------------------------------------------------------
-- Painel da carteira
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: cada contagem passa pelo RLS do usuário. Só retorna empresas
-- de escritórios em que o usuário é equipe.
create or replace function public.painel_carteira(p_competencia text)
returns table (
  empresa_id uuid,
  razao_social text,
  cnpj text,
  ativa boolean,
  matriz_confirmada boolean,
  competencia_situacao text,
  extratos_confirmados boolean,
  receitas_confirmadas boolean,
  sem_movimento boolean,
  lancamentos_pendentes integer,
  receitas_sem_vinculo integer,
  outras_entradas_pendentes integer,
  notas_rascunho integer,
  documentos_mes integer,
  chamados_abertos integer,
  chamados_aguardando_escritorio integer,
  chamado_mais_antigo timestamptz,
  tarefas_atrasadas integer,
  cobrancas_vencidas integer,
  pgdas_transmitida boolean,
  das_pago boolean,
  das_vencimento date,
  caixa_postal_novas integer,
  situacao_fiscal text,
  fiscal_atualizado_em timestamptz
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
    f.pgdas_transmitida, f.das_pago, f.das_vencimento, f.caixa_postal_novas, f.situacao_fiscal, f.atualizado_em
  from public.empresas e
  left join public.competencias c on c.empresa_id = e.id and c.competencia = p_competencia
  left join public.situacoes_fiscais f on f.empresa_id = e.id and f.competencia = p_competencia
  where privado.eh_equipe_escritorio(e.escritorio_id)
  order by e.razao_social;
$$;
revoke all on function public.painel_carteira(text) from public, anon;
grant execute on function public.painel_carteira(text) to authenticated;
