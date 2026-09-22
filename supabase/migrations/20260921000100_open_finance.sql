-- Extrato bancário via Open Finance (API de Extratos da TecnoSpeed), com busca D+1.
--
-- Por quê: o cliente deixa de importar OFX/CSV. O ContaGiro busca as movimentações do dia
-- anterior, o cliente categoriza e a contraparte (CPF/CNPJ) é cruzada com os cadastros.

-- Credenciais da Software House (escritório) na TecnoSpeed. O token fica no Vault
-- (token_segredo_id); aqui só a referência. Leitura pela equipe; gravação só pelo servidor.
create table public.integracoes_openfinance (
  escritorio_id uuid primary key references public.escritorios (id) on delete restrict,
  provedor text not null default 'tecnospeed' check (provedor in ('tecnospeed')),
  ambiente text not null default 'staging' check (ambiente in ('staging', 'producao')),
  cnpj_sh char(14) not null check (cnpj_sh ~ '^\d{14}$'),
  token_segredo_id uuid,
  ativa boolean not null default false,
  atualizado_por uuid references auth.users (id) on delete set null,
  atualizado_em timestamptz not null default now()
);
create index integracoes_openfinance_atualizado_por_idx on public.integracoes_openfinance (atualizado_por);
alter table public.integracoes_openfinance enable row level security;
create policy integracoes_openfinance_ver on public.integracoes_openfinance for select to authenticated
  using ((select privado.eh_equipe_escritorio(escritorio_id)));

-- Conexão de cada conta bancária da empresa com o Open Finance.
alter table public.contas_bancarias
  add column openfinance_account_hash text,
  add column openfinance_link text,             -- link de consentimento que o cliente abre no banco
  add column openfinance_id text,               -- preenchido pela TecnoSpeed após o consentimento
  add column openfinance_situacao text check (openfinance_situacao in ('aguardando_consentimento', 'conectada', 'revogada', 'demonstracao')),
  add column openfinance_ultimo_dia date;       -- último dia (D-1) já buscado
create unique index contas_bancarias_openfinance_hash on public.contas_bancarias (openfinance_account_hash) where openfinance_account_hash is not null;

-- Protocolos da busca assíncrona (a TecnoSpeed processa e devolve depois).
create table public.protocolos_extrato (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  conta_bancaria_id uuid not null references public.contas_bancarias (id) on delete restrict,
  unique_id text not null,
  data_inicio date not null,
  data_fim date not null,
  situacao text not null default 'processando' check (situacao in ('processando', 'concluido', 'erro')),
  mensagem text,
  movimentos integer,
  importados integer,
  solicitado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  concluido_em timestamptz,
  unique (conta_bancaria_id, unique_id)
);
create index protocolos_extrato_empresa_idx on public.protocolos_extrato (empresa_id, criado_em desc);
create index protocolos_extrato_solicitado_idx on public.protocolos_extrato (solicitado_por);
alter table public.protocolos_extrato enable row level security;
create policy protocolos_extrato_ver on public.protocolos_extrato for select to authenticated
  using ((select privado.papel_na_empresa(empresa_id)) is not null);

-- Movimentações vindas do Open Finance: id externo (deduplicação) e contraparte.
alter table public.movimentacoes_bancarias
  add column origem text not null default 'arquivo' check (origem in ('arquivo', 'openfinance', 'manual')),
  add column id_externo text,
  add column contraparte_nome text check (length(contraparte_nome) <= 180),
  add column contraparte_documento text check (contraparte_documento ~ '^(\d{11}|\d{14})$'),
  add column categoria_provedor text check (length(categoria_provedor) <= 80);
create unique index movimentacoes_id_externo_por_conta on public.movimentacoes_bancarias (conta_bancaria_id, id_externo) where id_externo is not null;
create index movimentacoes_contraparte_idx on public.movimentacoes_bancarias (empresa_id, contraparte_documento) where contraparte_documento is not null;
