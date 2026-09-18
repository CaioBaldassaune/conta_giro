-- ContaGiro • Base de acesso: perfis, escritórios, empresas, membros e convites.
-- Convenções: nomes em português, minúsculos, separados por "_".
-- Valores monetários sempre em centavos (bigint). Competência no formato AAAA-MM.

create extension if not exists pgcrypto with schema extensions;

-- Funções auxiliares ficam fora do schema exposto pela API.
create schema if not exists privado;
revoke all on schema privado from public, anon;
grant usage on schema privado to authenticated, service_role;

create domain public.competencia_mes as text
  check (value ~ '^\d{4}-(0[1-9]|1[0-2])$');

create or replace function privado.definir_atualizado_em()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Perfis (espelho de auth.users)
-- ---------------------------------------------------------------------------
create table public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null default '',
  email text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
comment on table public.perfis is 'Dados públicos do usuário autenticado (1:1 com auth.users).';

create trigger perfis_atualizado_em before update on public.perfis
  for each row execute function privado.definir_atualizado_em();

create or replace function privado.criar_perfil_novo_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfis (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nome', new.raw_user_meta_data ->> 'full_name', ''), coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger ao_criar_usuario after insert on auth.users
  for each row execute function privado.criar_perfil_novo_usuario();

-- ---------------------------------------------------------------------------
-- Escritórios de contabilidade e sua equipe
-- ---------------------------------------------------------------------------
create table public.escritorios (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 2 and 180),
  cnpj text check (cnpj ~ '^\d{14}$'),
  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index escritorios_cnpj_unico on public.escritorios (cnpj) where cnpj is not null;
create index escritorios_criado_por_idx on public.escritorios (criado_por);
create trigger escritorios_atualizado_em before update on public.escritorios
  for each row execute function privado.definir_atualizado_em();

create table public.membros_escritorio (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios (id) on delete cascade,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  papel text not null check (papel in ('titular', 'contador', 'assistente')),
  criado_em timestamptz not null default now(),
  unique (escritorio_id, usuario_id)
);
create index membros_escritorio_usuario_idx on public.membros_escritorio (usuario_id);
comment on table public.membros_escritorio is 'Equipe do escritório. Acessa o portal do contador (/contador).';

-- ---------------------------------------------------------------------------
-- Empresas clientes e seus usuários
-- ---------------------------------------------------------------------------
create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios (id) on delete restrict,
  razao_social text not null check (length(trim(razao_social)) between 2 and 180),
  nome_fantasia text,
  cnpj text check (cnpj ~ '^\d{14}$'),
  email text,
  telefone text,
  municipio text,
  uf char(2),
  codigo_ibge char(7) check (codigo_ibge ~ '^\d{7}$'),
  inscricao_municipal text,
  ativa boolean not null default true,
  demonstracao boolean not null default false,
  versao integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index empresas_escritorio_idx on public.empresas (escritorio_id);
create unique index empresas_cnpj_por_escritorio on public.empresas (escritorio_id, cnpj) where cnpj is not null;
create trigger empresas_atualizado_em before update on public.empresas
  for each row execute function privado.definir_atualizado_em();

create table public.membros_empresa (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  papel text not null check (papel in ('socio', 'financeiro', 'emissor', 'consulta')),
  criado_em timestamptz not null default now(),
  unique (empresa_id, usuario_id)
);
create index membros_empresa_usuario_idx on public.membros_empresa (usuario_id);
comment on table public.membros_empresa is 'Usuários do cliente. Acessam o portal do cliente (/cliente).';

-- ---------------------------------------------------------------------------
-- Convites (o cliente só entra por convite)
-- ---------------------------------------------------------------------------
create table public.convites (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios (id) on delete cascade,
  empresa_id uuid references public.empresas (id) on delete cascade,
  email text not null check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  papel text not null,
  token_hash text not null unique,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'aceito', 'revogado', 'expirado')),
  expira_em timestamptz not null default now() + interval '7 days',
  convidado_por uuid references auth.users (id) on delete set null,
  aceito_por uuid references auth.users (id) on delete set null,
  aceito_em timestamptz,
  criado_em timestamptz not null default now(),
  -- Convite sem empresa = equipe do escritório; com empresa = usuário do cliente.
  check (
    (empresa_id is null and papel in ('contador', 'assistente')) or
    (empresa_id is not null and papel in ('socio', 'financeiro', 'emissor', 'consulta'))
  )
);
create index convites_escritorio_idx on public.convites (escritorio_id);
create index convites_empresa_idx on public.convites (empresa_id);
create index convites_convidado_por_idx on public.convites (convidado_por);
create index convites_aceito_por_idx on public.convites (aceito_por);
create unique index convites_pendente_unico on public.convites (lower(email), coalesce(empresa_id, escritorio_id)) where situacao = 'pendente';

-- ---------------------------------------------------------------------------
-- Funções de autorização usadas pelas políticas RLS
-- ---------------------------------------------------------------------------
create or replace function privado.eh_equipe_escritorio(p_escritorio uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.membros_escritorio
    where escritorio_id = p_escritorio and usuario_id = (select auth.uid())
  );
$$;

-- Papel do usuário na empresa: 'equipe' (escritório responsável) ou o papel do cliente.
create or replace function privado.papel_na_empresa(p_empresa uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists (
      select 1 from public.empresas e
      join public.membros_escritorio m on m.escritorio_id = e.escritorio_id
      where e.id = p_empresa and m.usuario_id = (select auth.uid())
    ) then 'equipe'
    else (
      select papel from public.membros_empresa
      where empresa_id = p_empresa and usuario_id = (select auth.uid())
    )
  end;
$$;

create or replace function privado.papel_em(p_empresa uuid, variadic p_papeis text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(privado.papel_na_empresa(p_empresa) = any (p_papeis), false);
$$;

create or replace function privado.eh_equipe_empresa(p_empresa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(privado.papel_na_empresa(p_empresa) = 'equipe', false);
$$;

revoke all on all functions in schema privado from public, anon;
grant execute on function privado.eh_equipe_escritorio(uuid), privado.papel_na_empresa(uuid),
  privado.papel_em(uuid, text[]), privado.eh_equipe_empresa(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Operações que precisam furar o RLS de forma controlada
-- ---------------------------------------------------------------------------
-- Cria um escritório e torna o usuário atual titular.
create or replace function public.criar_escritorio(p_nome text, p_cnpj text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Entre com sua conta para criar o escritório.' using errcode = '42501';
  end if;
  insert into public.escritorios (nome, cnpj, criado_por)
  values (trim(p_nome), nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), ''), (select auth.uid()))
  returning id into v_id;
  insert into public.membros_escritorio (escritorio_id, usuario_id, papel)
  values (v_id, (select auth.uid()), 'titular');
  return v_id;
end $$;

-- Aceita um convite pelo token (o token em claro só existe no link enviado).
create or replace function public.aceitar_convite(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_convite public.convites;
  v_email text;
begin
  if (select auth.uid()) is null then
    raise exception 'Entre com sua conta para aceitar o convite.' using errcode = '42501';
  end if;
  select email into v_email from auth.users where id = (select auth.uid());

  select * into v_convite from public.convites
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if v_convite.id is null or v_convite.situacao <> 'pendente' then
    raise exception 'Convite inválido ou já utilizado.' using errcode = 'P0001';
  end if;
  if v_convite.expira_em < now() then
    update public.convites set situacao = 'expirado' where id = v_convite.id;
    raise exception 'Convite expirado. Peça um novo ao escritório.' using errcode = 'P0001';
  end if;
  if lower(v_email) <> lower(v_convite.email) then
    raise exception 'Este convite foi enviado para outro e-mail.' using errcode = '42501';
  end if;

  if v_convite.empresa_id is null then
    insert into public.membros_escritorio (escritorio_id, usuario_id, papel)
    values (v_convite.escritorio_id, (select auth.uid()), v_convite.papel)
    on conflict (escritorio_id, usuario_id) do update set papel = excluded.papel;
  else
    insert into public.membros_empresa (empresa_id, usuario_id, papel)
    values (v_convite.empresa_id, (select auth.uid()), v_convite.papel)
    on conflict (empresa_id, usuario_id) do update set papel = excluded.papel;
  end if;

  update public.convites
  set situacao = 'aceito', aceito_por = (select auth.uid()), aceito_em = now()
  where id = v_convite.id;

  return jsonb_build_object(
    'portal', case when v_convite.empresa_id is null then 'contador' else 'cliente' end,
    'escritorio_id', v_convite.escritorio_id,
    'empresa_id', v_convite.empresa_id
  );
end $$;

revoke all on function public.criar_escritorio(text, text), public.aceitar_convite(text) from public, anon;
grant execute on function public.criar_escritorio(text, text), public.aceitar_convite(text) to authenticated;
