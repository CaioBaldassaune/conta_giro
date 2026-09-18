-- ContaGiro • Emissão de NFS-e pelo Sistema Nacional (Sefin Nacional, leiaute DPS v1.01).
--
-- Por empresa: configuração do emissor (ambiente, série, numeração, regime) e o
-- certificado A1 da própria empresa (prestador), guardado no Vault.
-- A emissão é feita pelo servidor; a numeração da DPS é reservada de forma atômica.

create table public.configuracoes_nfse (
  empresa_id uuid primary key references public.empresas (id) on delete restrict,
  ambiente text not null default 'producao_restrita' check (ambiente in ('producao_restrita', 'producao')),
  serie_dps text not null default '1' check (serie_dps ~ '^\d{1,5}$'),
  proximo_numero_dps bigint not null default 1 check (proximo_numero_dps >= 1),
  codigo_ibge_emissao char(7) not null check (codigo_ibge_emissao ~ '^\d{7}$'),
  inscricao_municipal text,
  op_simples_nacional text not null default '3' check (op_simples_nacional in ('1', '2', '3')),
  regime_apuracao_sn text check (regime_apuracao_sn in ('1', '2', '3')),
  regime_especial text not null default '0' check (regime_especial in ('0', '1', '2', '3', '4', '5', '6', '9')),
  ativa boolean not null default false,
  atualizado_por uuid references auth.users (id) on delete set null,
  atualizado_em timestamptz not null default now(),
  check (op_simples_nacional <> '3' or regime_apuracao_sn is not null)
);
create index configuracoes_nfse_atualizado_por_idx on public.configuracoes_nfse (atualizado_por);
alter table public.configuracoes_nfse enable row level security;
create policy configuracoes_nfse_ver on public.configuracoes_nfse for select to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro', 'emissor'));
create policy configuracoes_nfse_incluir on public.configuracoes_nfse for insert to authenticated
  with check (privado.eh_equipe_empresa(empresa_id));
create policy configuracoes_nfse_editar on public.configuracoes_nfse for update to authenticated
  using (privado.eh_equipe_empresa(empresa_id)) with check (privado.eh_equipe_empresa(empresa_id));

-- Controle fiscal da nota emitida.
alter table public.notas_fiscais
  add column serie_dps text,
  add column numero_dps bigint,
  add column id_dps text,
  add column ambiente text check (ambiente in ('producao_restrita', 'producao')),
  add column documento_pdf_id uuid references public.documentos (id) on delete restrict,
  add column retorno_emissao jsonb;
create unique index notas_fiscais_dps_unica on public.notas_fiscais (empresa_id, ambiente, serie_dps, numero_dps) where numero_dps is not null;
create index notas_fiscais_documento_pdf_idx on public.notas_fiscais (documento_pdf_id);

-- Reserva o próximo número da DPS (sem buracos em concorrência). Quem pode emitir:
-- equipe, sócio, financeiro e emissor da empresa.
create or replace function public.reservar_numero_dps(p_empresa uuid)
returns table (r_serie text, r_numero bigint, r_ambiente text) language plpgsql security definer set search_path = '' as $$
begin
  if not privado.papel_em(p_empresa, 'equipe', 'socio', 'financeiro', 'emissor') then
    raise exception 'Seu perfil não pode emitir notas desta empresa.' using errcode = '42501';
  end if;
  return query
    with reservado as (
      update public.configuracoes_nfse c
      set proximo_numero_dps = c.proximo_numero_dps + 1
      where c.empresa_id = p_empresa and c.ativa
      returning c.serie_dps, c.proximo_numero_dps - 1 as numero, c.ambiente
    )
    select reservado.serie_dps, reservado.numero, reservado.ambiente from reservado;
  if not found then
    raise exception 'Emissão de NFS-e não configurada ou inativa para esta empresa.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.reservar_numero_dps(uuid) from public, anon;
grant execute on function public.reservar_numero_dps(uuid) to authenticated;

-- Cofre genérico para o servidor (service_role): certificados das empresas etc.
create or replace function public.cofre_guardar(p_valor text, p_nome text)
returns uuid language sql security definer set search_path = '' as $$
  select privado.guardar_segredo(p_valor, p_nome, 'ContaGiro');
$$;
create or replace function public.cofre_ler(p_id uuid)
returns text language sql security definer set search_path = '' as $$
  select privado.ler_segredo(p_id);
$$;
create or replace function public.cofre_apagar(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  select privado.apagar_segredo(p_id);
$$;
revoke all on function public.cofre_guardar(text, text), public.cofre_ler(uuid), public.cofre_apagar(uuid) from public, anon, authenticated;
grant execute on function public.cofre_guardar(text, text), public.cofre_ler(uuid), public.cofre_apagar(uuid) to service_role;
