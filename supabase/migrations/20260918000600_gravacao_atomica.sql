-- ContaGiro • Ajustes para a camada de tradução e gravação atômica.
--
-- O servidor aplica as regras (lib/domain.ts) e envia todas as linhas alteradas de
-- uma ação para public.aplicar_alteracoes, que grava tudo numa única transação,
-- com trava otimista por empresa e registro de auditoria. A função é SECURITY
-- INVOKER: o RLS de cada tabela continua valendo para o usuário logado.

-- Atividades mantêm a mesma referência entre versões da matriz.
alter table public.atividades_empresa add column referencia uuid not null;
create unique index atividades_referencia_por_versao on public.atividades_empresa (versao_matriz_id, referencia);

alter table public.documentos add column arquivado_por_email text;
alter table public.historico_receitas add column despesas bigint check (despesas >= 0);
-- A origem de uma notificação pode ser uma competência (AAAA-MM) ou um registro.
alter table public.notificacoes alter column origem_id type text using origem_id::text;
-- Nem toda conclusão automática traz evidência textual (ex.: revisão de outras entradas).
alter table public.tarefas drop constraint if exists tarefas_check;
-- Lead registrado a partir de uma empresa da carteira (opcional).
alter table public.leads_comerciais add column empresa_id uuid references public.empresas (id) on delete restrict;
create index leads_comerciais_empresa_idx on public.leads_comerciais (empresa_id);

-- Trava otimista: só incrementa a versão se ninguém alterou a empresa antes.
create or replace function privado.travar_empresa(p_empresa uuid, p_versao integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_nova integer;
begin
  if privado.papel_na_empresa(p_empresa) is null then
    raise exception 'Empresa não disponível para este acesso.' using errcode = '42501';
  end if;
  update public.empresas set versao = versao + 1
  where id = p_empresa and versao = p_versao
  returning versao into v_nova;
  if v_nova is null then
    raise exception 'CONFLITO_VERSAO' using errcode = '40001';
  end if;
  return v_nova;
end $$;
revoke all on function privado.travar_empresa(uuid, integer) from public, anon;
grant execute on function privado.travar_empresa(uuid, integer) to authenticated, service_role;

create or replace function public.aplicar_alteracoes(
  p_empresa uuid,
  p_versao integer,
  p_linhas jsonb,
  p_acao text,
  p_detalhe text
) returns integer language plpgsql security invoker set search_path = '' as $$
declare
  c_permitidas constant text[] := array[
    'competencias', 'historico_receitas', 'versoes_matriz_tributaria', 'atividades_empresa',
    'documentos', 'eventos_documento', 'ciencias_documento', 'solicitacoes', 'contatos',
    'notas_fiscais', 'contas_bancarias', 'movimentacoes_bancarias', 'regras_classificacao',
    'contas_pagar', 'notificacoes', 'leituras_notificacao', 'tarefas', 'leads_comerciais',
    'assinaturas', 'cobrancas', 'colaboradores', 'folhas_pagamento', 'configuracoes_contabeis',
    'plano_contas', 'mapeamentos_categoria_conta', 'lancamentos_contabeis', 'fechamentos_contabeis'
  ];
  v_nova integer;
  v_item jsonb;
  v_tabela text;
  v_linha jsonb;
  v_rel regclass;
  v_cols text[];
  v_pk text[];
  v_lista text;
  v_set text;
begin
  v_nova := privado.travar_empresa(p_empresa, p_versao);

  for v_item in select value from jsonb_array_elements(p_linhas) loop
    v_tabela := v_item ->> 'tabela';
    v_linha := v_item -> 'linha';
    if v_tabela is null or not v_tabela = any (c_permitidas) then
      raise exception 'Tabela não permitida: %', v_tabela using errcode = '42501';
    end if;
    v_rel := format('public.%I', v_tabela)::regclass;

    -- Toda linha com empresa_id pertence obrigatoriamente à empresa travada.
    if exists (select 1 from pg_attribute where attrelid = v_rel and attname = 'empresa_id' and not attisdropped) then
      if v_linha ? 'empresa_id' and (v_linha ->> 'empresa_id') is distinct from p_empresa::text then
        raise exception 'Registro de outra empresa.' using errcode = '42501';
      end if;
      v_linha := v_linha || jsonb_build_object('empresa_id', p_empresa);
    end if;

    select array_agg(a.attname::text order by a.attnum) into v_cols
    from pg_attribute a
    where a.attrelid = v_rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
      and v_linha ? a.attname;

    select array_agg(a.attname::text) into v_pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
    where i.indrelid = v_rel and i.indisprimary;

    select string_agg(format('%I', c), ', ') into v_lista from unnest(v_cols) c;
    select string_agg(format('%I = excluded.%I', c, c), ', ') into v_set
    from unnest(v_cols) c where not c = any (v_pk);

    execute format(
      'insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1) on conflict (%s) do %s',
      v_rel, v_lista, v_lista, v_rel,
      (select string_agg(format('%I', c), ', ') from unnest(v_pk) c),
      coalesce('update set ' || v_set, 'nothing')
    ) using v_linha;
  end loop;

  insert into public.registros_auditoria (empresa_id, ator_id, ator_email, acao, detalhe)
  values (p_empresa, (select auth.uid()), coalesce((select auth.jwt()) ->> 'email', ''), p_acao, left(p_detalhe, 2000));

  return v_nova;
end $$;

revoke all on function public.aplicar_alteracoes(uuid, integer, jsonb, text, text) from public, anon;
grant execute on function public.aplicar_alteracoes(uuid, integer, jsonb, text, text) to authenticated;
