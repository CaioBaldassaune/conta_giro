-- ContaGiro • Integrações: API do Domínio (Thomson Reuters/Onvio) e captura de NFS-e
-- pelo Ambiente de Dados Nacional (ADN).
--
-- Segredos (chaves de integração, certificado A1 e senha) NUNCA ficam em colunas:
-- são gravados no Supabase Vault e aqui guardamos apenas o id do segredo.
-- As credenciais do ContaGiro como integrador (client_id/client_secret da Thomson
-- Reuters) ficam em variáveis de ambiente do servidor, não no banco.

create extension if not exists supabase_vault with schema vault;

-- ---------------------------------------------------------------------------
-- Domínio: vínculo por empresa (x-integration-key gerada no Domínio pelo escritório)
-- Fluxo da API: token OAuth -> /activation/info (confere CNPJs) ->
-- /activation/enable (chave definitiva) -> /invoice/v3/batches (envio de XML)
-- ---------------------------------------------------------------------------
create table public.vinculos_dominio (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios (id) on delete restrict,
  empresa_id uuid not null unique references public.empresas (id) on delete restrict,
  chave_ativacao_segredo_id uuid,
  chave_integracao_segredo_id uuid,
  cnpj_escritorio_confirmado char(14),
  cnpj_cliente_confirmado char(14),
  situacao text not null default 'pendente' check (situacao in ('pendente', 'ativo', 'erro', 'revogado')),
  mensagem text,
  ativado_em timestamptz,
  ultima_verificacao_em timestamptz,
  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (situacao <> 'ativo' or chave_integracao_segredo_id is not null)
);
create index vinculos_dominio_escritorio_idx on public.vinculos_dominio (escritorio_id);
create index vinculos_dominio_criado_por_idx on public.vinculos_dominio (criado_por);
create trigger vinculos_dominio_atualizado_em before update on public.vinculos_dominio
  for each row execute function privado.definir_atualizado_em();

create table public.envios_dominio (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  documento_id uuid not null references public.documentos (id) on delete restrict,
  nota_fiscal_id uuid references public.notas_fiscais (id) on delete restrict,
  lote_id text,
  enviar_boxe boolean not null default false,
  situacao text not null default 'na_fila' check (situacao in ('na_fila', 'enviado', 'armazenado', 'rejeitado', 'erro')),
  mensagem_api text,
  resposta jsonb,
  tentativas integer not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  enviado_em timestamptz,
  verificado_em timestamptz,
  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index envios_dominio_empresa_idx on public.envios_dominio (empresa_id, criado_em desc);
create index envios_dominio_fila_idx on public.envios_dominio (proxima_tentativa_em) where situacao in ('na_fila', 'enviado', 'erro');
create index envios_dominio_documento_idx on public.envios_dominio (documento_id);
create index envios_dominio_nota_idx on public.envios_dominio (nota_fiscal_id);
create index envios_dominio_criado_por_idx on public.envios_dominio (criado_por);
-- Um mesmo XML não pode ter dois envios em andamento/concluídos.
create unique index envios_dominio_documento_ativo on public.envios_dominio (documento_id) where situacao in ('na_fila', 'enviado', 'armazenado');
create trigger envios_dominio_atualizado_em before update on public.envios_dominio
  for each row execute function privado.definir_atualizado_em();

-- ---------------------------------------------------------------------------
-- Captura de NFS-e pelo ADN (requer certificado A1 da empresa)
-- ---------------------------------------------------------------------------
create table public.certificados_digitais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  cnpj char(14) not null check (cnpj ~ '^\d{14}$'),
  titular text not null,
  emissor text,
  valido_de timestamptz not null,
  valido_ate timestamptz not null,
  arquivo_segredo_id uuid not null,
  senha_segredo_id uuid not null,
  situacao text not null default 'ativo' check (situacao in ('ativo', 'substituido', 'revogado')),
  enviado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  check (valido_ate > valido_de)
);
create index certificados_empresa_idx on public.certificados_digitais (empresa_id);
create index certificados_enviado_por_idx on public.certificados_digitais (enviado_por);
create unique index certificados_ativo_unico on public.certificados_digitais (empresa_id) where situacao = 'ativo';

create table public.capturas_nfse (
  empresa_id uuid primary key references public.empresas (id) on delete restrict,
  ambiente text not null default 'producao_restrita' check (ambiente in ('producao_restrita', 'producao')),
  ativa boolean not null default false,
  ultimo_nsu bigint not null default 0 check (ultimo_nsu >= 0),
  enviar_ao_dominio boolean not null default false,
  ultima_execucao_em timestamptz,
  situacao text not null default 'aguardando' check (situacao in ('aguardando', 'executando', 'ok', 'erro')),
  mensagem text,
  atualizado_em timestamptz not null default now()
);
create trigger capturas_nfse_atualizado_em before update on public.capturas_nfse
  for each row execute function privado.definir_atualizado_em();

create table public.execucoes_captura_nfse (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  iniciada_em timestamptz not null default now(),
  concluida_em timestamptz,
  nsu_inicial bigint not null,
  nsu_final bigint,
  documentos_recebidos integer not null default 0,
  notas_novas integer not null default 0,
  situacao text not null default 'executando' check (situacao in ('executando', 'ok', 'erro')),
  mensagem text
);
create index execucoes_captura_empresa_idx on public.execucoes_captura_nfse (empresa_id, iniciada_em desc);

-- Tabela de referência: emissor de NFS-e por município (padrão nacional ou próprio).
create table public.municipios_nfse (
  codigo_ibge char(7) primary key check (codigo_ibge ~ '^\d{7}$'),
  municipio text not null,
  uf char(2) not null,
  emissor text not null check (emissor in ('padrao_nacional', 'proprio')),
  integrado_dominio boolean,
  atualizado_em timestamptz not null default now()
);
create index municipios_nfse_nome_idx on public.municipios_nfse (uf, municipio);

-- ---------------------------------------------------------------------------
-- Acesso ao Vault: somente o servidor (service_role) grava e lê segredos.
-- ---------------------------------------------------------------------------
create or replace function privado.guardar_segredo(p_valor text, p_nome text, p_descricao text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return vault.create_secret(p_valor, p_nome || ':' || gen_random_uuid()::text, p_descricao);
end $$;

create or replace function privado.ler_segredo(p_id uuid)
returns text language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_id;
$$;

create or replace function privado.apagar_segredo(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from vault.secrets where id = p_id;
$$;

revoke all on function privado.guardar_segredo(text, text, text), privado.ler_segredo(uuid), privado.apagar_segredo(uuid)
  from public, anon, authenticated;
grant execute on function privado.guardar_segredo(text, text, text), privado.ler_segredo(uuid), privado.apagar_segredo(uuid)
  to service_role;
