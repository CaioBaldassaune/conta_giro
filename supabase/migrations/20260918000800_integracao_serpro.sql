-- ContaGiro • Integração SERPRO Integra Contador.
--
-- O escritório é o contratante e o autor dos pedidos (dispensa termo de autorização);
-- cada cliente deu procuração no e-CAC ao CNPJ do escritório.
-- Segredos (chave/segredo da Loja SERPRO, certificado e-CNPJ e senha) ficam no Vault.
-- Toda gravação aqui é feita pelo servidor com a chave de serviço (service_role);
-- a equipe só consulta metadados e o consumo.

create table public.integracoes_serpro (
  escritorio_id uuid primary key references public.escritorios (id) on delete restrict,
  cnpj_contratante char(14) not null check (cnpj_contratante ~ '^\d{14}$'),
  titular_certificado text not null,
  certificado_valido_ate timestamptz not null,
  consumer_key_segredo_id uuid not null,
  consumer_secret_segredo_id uuid not null,
  certificado_segredo_id uuid not null,
  senha_segredo_id uuid not null,
  ativa boolean not null default true,
  ultimo_teste_em timestamptz,
  ultimo_teste_ok boolean,
  atualizado_por uuid references auth.users (id) on delete set null,
  atualizado_em timestamptz not null default now()
);
create index integracoes_serpro_atualizado_por_idx on public.integracoes_serpro (atualizado_por);
alter table public.integracoes_serpro enable row level security;
create policy integracoes_serpro_ver on public.integracoes_serpro for select to authenticated
  using (privado.eh_equipe_escritorio(escritorio_id));

-- Registro de cada chamada (controle de custo: o SERPRO cobra por requisição).
create table public.requisicoes_serpro (
  id bigint generated always as identity primary key,
  escritorio_id uuid not null references public.escritorios (id) on delete restrict,
  empresa_id uuid references public.empresas (id) on delete restrict,
  tipo text not null check (tipo in ('Apoiar', 'Consultar', 'Declarar', 'Emitir', 'Monitorar')),
  id_sistema text not null,
  id_servico text not null,
  status_http integer,
  bilhetada boolean not null,
  mensagem text,
  x_request_tag text,
  duracao_ms integer,
  solicitado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now()
);
create index requisicoes_serpro_escritorio_idx on public.requisicoes_serpro (escritorio_id, criado_em desc);
create index requisicoes_serpro_empresa_idx on public.requisicoes_serpro (empresa_id);
create index requisicoes_serpro_solicitado_por_idx on public.requisicoes_serpro (solicitado_por);
alter table public.requisicoes_serpro enable row level security;
create policy requisicoes_serpro_ver on public.requisicoes_serpro for select to authenticated
  using (privado.eh_equipe_escritorio(escritorio_id));

comment on table public.requisicoes_serpro is
  'Chamadas ao Integra Contador. bilhetada = cobrada pelo SERPRO (Apoiar/Monitorar e erros 204/304/400/401/404/429/500/503 não são).';

-- A equipe precisa ler a situação fiscal no painel; o servidor grava.
-- (situacoes_fiscais já existe com leitura para equipe e sócio.)

-- O servidor (service_role) precisa ler segredos do Vault: já liberado em
-- privado.guardar_segredo / ler_segredo / apagar_segredo. Expõe versões
-- chamáveis pela API somente para service_role.
create or replace function public.serpro_guardar_segredo(p_valor text, p_nome text)
returns uuid language sql security definer set search_path = '' as $$
  select privado.guardar_segredo(p_valor, p_nome, 'ContaGiro • integração SERPRO');
$$;
create or replace function public.serpro_ler_segredo(p_id uuid)
returns text language sql security definer set search_path = '' as $$
  select privado.ler_segredo(p_id);
$$;
create or replace function public.serpro_apagar_segredo(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  select privado.apagar_segredo(p_id);
$$;
revoke all on function public.serpro_guardar_segredo(text, text), public.serpro_ler_segredo(uuid), public.serpro_apagar_segredo(uuid)
  from public, anon, authenticated;
grant execute on function public.serpro_guardar_segredo(text, text), public.serpro_ler_segredo(uuid), public.serpro_apagar_segredo(uuid)
  to service_role;
