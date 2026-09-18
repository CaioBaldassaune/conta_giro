-- ContaGiro • Row Level Security e Storage.
--
-- Papéis por empresa (privado.papel_na_empresa):
--   equipe     -> membro do escritório responsável (portal /contador)
--   socio      -> administrador do cliente
--   financeiro -> classifica, importa, envia documentos
--   emissor    -> apenas notas fiscais e tomadores
--   consulta   -> somente leitura (registra ciência e leitura)
-- As regras finas de cada ação continuam no servidor (lib/domain.ts); o RLS é a
-- barreira que impede acesso fora da empresa/papel mesmo se o código errar.
-- Não há políticas de DELETE: exclusão só pelo servidor (service_role), quando prevista.

create or replace function privado.eh_titular_escritorio(p_escritorio uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.membros_escritorio
    where escritorio_id = p_escritorio and usuario_id = (select auth.uid()) and papel = 'titular'
  );
$$;

create or replace function privado.empresa_do_escritorio(p_empresa uuid, p_escritorio uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.empresas where id = p_empresa and escritorio_id = p_escritorio);
$$;

revoke all on function privado.eh_titular_escritorio(uuid), privado.empresa_do_escritorio(uuid, uuid) from public, anon;
grant execute on function privado.eh_titular_escritorio(uuid), privado.empresa_do_escritorio(uuid, uuid) to authenticated, service_role;

-- Nenhum acesso anônimo às tabelas do sistema.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- Liga o RLS em todas as tabelas do schema public.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ===========================================================================
-- Acesso
-- ===========================================================================
create policy perfis_ver on public.perfis for select to authenticated using (
  id = (select auth.uid())
  or exists (select 1 from public.membros_empresa me where me.usuario_id = perfis.id and privado.eh_equipe_empresa(me.empresa_id))
  or exists (select 1 from public.membros_escritorio me where me.usuario_id = perfis.id and privado.eh_equipe_escritorio(me.escritorio_id))
);
create policy perfis_editar_proprio on public.perfis for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy escritorios_ver on public.escritorios for select to authenticated using (
  privado.eh_equipe_escritorio(id)
  or exists (select 1 from public.empresas e where e.escritorio_id = escritorios.id and privado.papel_na_empresa(e.id) is not null)
);
create policy escritorios_editar on public.escritorios for update to authenticated
  using (privado.eh_titular_escritorio(id)) with check (privado.eh_titular_escritorio(id));

create policy membros_escritorio_ver on public.membros_escritorio for select to authenticated
  using (privado.eh_equipe_escritorio(escritorio_id));
create policy membros_escritorio_incluir on public.membros_escritorio for insert to authenticated
  with check (privado.eh_titular_escritorio(escritorio_id));
create policy membros_escritorio_editar on public.membros_escritorio for update to authenticated
  using (privado.eh_titular_escritorio(escritorio_id)) with check (privado.eh_titular_escritorio(escritorio_id));
create policy membros_escritorio_remover on public.membros_escritorio for delete to authenticated
  using (privado.eh_titular_escritorio(escritorio_id) and usuario_id <> (select auth.uid()));

create policy empresas_ver on public.empresas for select to authenticated
  using (privado.papel_na_empresa(id) is not null);
create policy empresas_incluir on public.empresas for insert to authenticated
  with check (privado.eh_equipe_escritorio(escritorio_id));
create policy empresas_editar on public.empresas for update to authenticated
  using (privado.eh_equipe_escritorio(escritorio_id)) with check (privado.eh_equipe_escritorio(escritorio_id));

create policy membros_empresa_ver on public.membros_empresa for select to authenticated
  using (usuario_id = (select auth.uid()) or privado.papel_em(empresa_id, 'equipe', 'socio'));
create policy membros_empresa_incluir on public.membros_empresa for insert to authenticated
  with check (privado.eh_equipe_empresa(empresa_id));
create policy membros_empresa_editar on public.membros_empresa for update to authenticated
  using (privado.eh_equipe_empresa(empresa_id)) with check (privado.eh_equipe_empresa(empresa_id));
create policy membros_empresa_remover on public.membros_empresa for delete to authenticated
  using (privado.eh_equipe_empresa(empresa_id));

create policy convites_ver on public.convites for select to authenticated using (
  privado.eh_equipe_escritorio(escritorio_id)
  or (empresa_id is not null and privado.papel_em(empresa_id, 'socio'))
);
create policy convites_incluir on public.convites for insert to authenticated with check (
  convidado_por = (select auth.uid())
  and (empresa_id is null or privado.empresa_do_escritorio(empresa_id, escritorio_id))
  and (privado.eh_equipe_escritorio(escritorio_id) or (empresa_id is not null and privado.papel_em(empresa_id, 'socio')))
);
create policy convites_editar on public.convites for update to authenticated using (
  privado.eh_equipe_escritorio(escritorio_id) or (empresa_id is not null and privado.papel_em(empresa_id, 'socio'))
) with check (
  privado.eh_equipe_escritorio(escritorio_id) or (empresa_id is not null and privado.papel_em(empresa_id, 'socio'))
);

-- ===========================================================================
-- Documentos
-- ===========================================================================
create policy documentos_ver on public.documentos for select to authenticated using (
  privado.papel_em(empresa_id, 'equipe', 'socio')
  or (categoria <> 'pessoal' and privado.papel_em(empresa_id, 'financeiro', 'consulta'))
  or (categoria in ('nota_fiscal', 'xml_nfse') and privado.papel_em(empresa_id, 'emissor'))
);
create policy documentos_incluir on public.documentos for insert to authenticated with check (
  enviado_por = (select auth.uid())
  and (
    (categoria <> 'pessoal' and privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'))
    or (categoria = 'pessoal' and privado.papel_em(empresa_id, 'equipe', 'socio'))
  )
);
create policy documentos_editar on public.documentos for update to authenticated using (
  (categoria <> 'pessoal' and privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'))
  or (categoria = 'pessoal' and privado.papel_em(empresa_id, 'equipe', 'socio'))
) with check (
  (categoria <> 'pessoal' and privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'))
  or (categoria = 'pessoal' and privado.papel_em(empresa_id, 'equipe', 'socio'))
);

create policy eventos_documento_ver on public.eventos_documento for select to authenticated
  using (exists (select 1 from public.documentos d where d.id = documento_id));
create policy eventos_documento_incluir on public.eventos_documento for insert to authenticated with check (
  ator_id = (select auth.uid())
  and exists (select 1 from public.documentos d where d.id = documento_id and d.empresa_id = eventos_documento.empresa_id)
);

create policy ciencias_documento_ver on public.ciencias_documento for select to authenticated using (
  usuario_id = (select auth.uid())
  or exists (select 1 from public.documentos d where d.id = documento_id and privado.papel_em(d.empresa_id, 'equipe', 'socio'))
);
create policy ciencias_documento_incluir on public.ciencias_documento for insert to authenticated with check (
  usuario_id = (select auth.uid()) and exists (select 1 from public.documentos d where d.id = documento_id)
);

-- ===========================================================================
-- Operação do cliente
-- ===========================================================================
create policy solicitacoes_ver on public.solicitacoes for select to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro', 'consulta'));
create policy solicitacoes_incluir on public.solicitacoes for insert to authenticated
  with check (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'));
create policy solicitacoes_editar on public.solicitacoes for update to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'))
  with check (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'));

create policy versoes_matriz_ver on public.versoes_matriz_tributaria for select to authenticated
  using (privado.papel_na_empresa(empresa_id) is not null);
create policy versoes_matriz_incluir on public.versoes_matriz_tributaria for insert to authenticated
  with check (privado.eh_equipe_empresa(empresa_id));

create policy atividades_ver on public.atividades_empresa for select to authenticated
  using (privado.papel_na_empresa(empresa_id) is not null);
create policy atividades_incluir on public.atividades_empresa for insert to authenticated
  with check (privado.eh_equipe_empresa(empresa_id));

create policy historico_receitas_ver on public.historico_receitas for select to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro', 'consulta'));
create policy historico_receitas_incluir on public.historico_receitas for insert to authenticated
  with check (privado.eh_equipe_empresa(empresa_id));
create policy historico_receitas_editar on public.historico_receitas for update to authenticated
  using (privado.eh_equipe_empresa(empresa_id)) with check (privado.eh_equipe_empresa(empresa_id));

create policy competencias_ver on public.competencias for select to authenticated
  using (privado.papel_na_empresa(empresa_id) is not null);
create policy competencias_incluir on public.competencias for insert to authenticated
  with check (privado.eh_equipe_empresa(empresa_id));
create policy competencias_editar on public.competencias for update to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'))
  with check (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'));

create policy contatos_ver on public.contatos for select to authenticated using (
  privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro', 'consulta')
  or (tipo in ('tomador', 'ambos') and privado.papel_em(empresa_id, 'emissor'))
);
create policy contatos_incluir on public.contatos for insert to authenticated with check (
  privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro')
  or (tipo = 'tomador' and privado.papel_em(empresa_id, 'emissor'))
);
create policy contatos_editar on public.contatos for update to authenticated using (
  privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro')
  or (tipo = 'tomador' and privado.papel_em(empresa_id, 'emissor'))
) with check (
  privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro')
  or (tipo = 'tomador' and privado.papel_em(empresa_id, 'emissor'))
);

create policy notas_fiscais_ver on public.notas_fiscais for select to authenticated
  using (privado.papel_na_empresa(empresa_id) is not null);
create policy notas_fiscais_incluir on public.notas_fiscais for insert to authenticated
  with check (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro', 'emissor'));
create policy notas_fiscais_editar on public.notas_fiscais for update to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro', 'emissor'))
  with check (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro', 'emissor'));

create policy contas_bancarias_ver on public.contas_bancarias for select to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro', 'consulta'));
create policy contas_bancarias_incluir on public.contas_bancarias for insert to authenticated
  with check (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'));
create policy contas_bancarias_editar on public.contas_bancarias for update to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'))
  with check (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'));

create policy movimentacoes_ver on public.movimentacoes_bancarias for select to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro', 'consulta'));
create policy movimentacoes_incluir on public.movimentacoes_bancarias for insert to authenticated
  with check (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'));
create policy movimentacoes_editar on public.movimentacoes_bancarias for update to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'))
  with check (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'));

create policy regras_ver on public.regras_classificacao for select to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro', 'consulta'));
create policy regras_incluir on public.regras_classificacao for insert to authenticated
  with check (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'));
create policy regras_editar on public.regras_classificacao for update to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'))
  with check (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'));

create policy contas_pagar_ver on public.contas_pagar for select to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro', 'consulta'));
create policy contas_pagar_incluir on public.contas_pagar for insert to authenticated
  with check (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'));
create policy contas_pagar_editar on public.contas_pagar for update to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'))
  with check (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'));

create policy notificacoes_ver on public.notificacoes for select to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro', 'consulta'));
create policy notificacoes_incluir on public.notificacoes for insert to authenticated
  with check (privado.papel_em(empresa_id, 'equipe', 'socio', 'financeiro'));

create policy leituras_notificacao_ver on public.leituras_notificacao for select to authenticated using (
  usuario_id = (select auth.uid())
  or exists (select 1 from public.notificacoes n where n.id = notificacao_id and privado.eh_equipe_empresa(n.empresa_id))
);
create policy leituras_notificacao_incluir on public.leituras_notificacao for insert to authenticated with check (
  usuario_id = (select auth.uid()) and exists (select 1 from public.notificacoes n where n.id = notificacao_id)
);

-- ===========================================================================
-- Escritório: tarefas, comercial, cobrança
-- ===========================================================================
create policy tarefas_equipe on public.tarefas for all to authenticated using (
  privado.eh_equipe_escritorio(escritorio_id)
) with check (
  privado.eh_equipe_escritorio(escritorio_id)
  and (empresa_id is null or privado.empresa_do_escritorio(empresa_id, escritorio_id))
);
-- "for all" inclui delete; tarefas não devem ser apagadas pela interface.
create policy tarefas_sem_exclusao on public.tarefas as restrictive for delete to authenticated using (false);

create policy leads_equipe on public.leads_comerciais for all to authenticated
  using (privado.eh_equipe_escritorio(escritorio_id)) with check (privado.eh_equipe_escritorio(escritorio_id));
create policy leads_sem_exclusao on public.leads_comerciais as restrictive for delete to authenticated using (false);

create policy assinaturas_ver on public.assinaturas for select to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio'));
create policy assinaturas_incluir on public.assinaturas for insert to authenticated
  with check (privado.eh_equipe_escritorio(escritorio_id) and privado.empresa_do_escritorio(empresa_id, escritorio_id));
create policy assinaturas_editar on public.assinaturas for update to authenticated
  using (privado.eh_equipe_escritorio(escritorio_id))
  with check (privado.eh_equipe_escritorio(escritorio_id) and privado.empresa_do_escritorio(empresa_id, escritorio_id));

create policy cobrancas_ver on public.cobrancas for select to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio'));
create policy cobrancas_incluir on public.cobrancas for insert to authenticated with check (
  privado.empresa_do_escritorio(empresa_id, escritorio_id)
  and (privado.eh_equipe_escritorio(escritorio_id) or (origem = 'servico_extra' and privado.papel_em(empresa_id, 'socio')))
);
create policy cobrancas_editar on public.cobrancas for update to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio'))
  with check (privado.papel_em(empresa_id, 'equipe', 'socio') and privado.empresa_do_escritorio(empresa_id, escritorio_id));

-- ===========================================================================
-- Folha (sensível)
-- ===========================================================================
create policy colaboradores_ver on public.colaboradores for select to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio'));
create policy colaboradores_incluir on public.colaboradores for insert to authenticated
  with check (privado.eh_equipe_empresa(empresa_id));
create policy colaboradores_editar on public.colaboradores for update to authenticated
  using (privado.eh_equipe_empresa(empresa_id)) with check (privado.eh_equipe_empresa(empresa_id));

create policy folhas_ver on public.folhas_pagamento for select to authenticated
  using (privado.papel_em(empresa_id, 'equipe', 'socio'));
create policy folhas_incluir on public.folhas_pagamento for insert to authenticated
  with check (privado.eh_equipe_empresa(empresa_id));
create policy folhas_editar on public.folhas_pagamento for update to authenticated
  using (privado.eh_equipe_empresa(empresa_id)) with check (privado.eh_equipe_empresa(empresa_id));

-- ===========================================================================
-- Contabilidade e integrações: somente a equipe do escritório
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'configuracoes_contabeis', 'plano_contas', 'mapeamentos_categoria_conta', 'lancamentos_contabeis',
    'fechamentos_contabeis', 'vinculos_dominio', 'envios_dominio', 'capturas_nfse', 'execucoes_captura_nfse'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (privado.eh_equipe_empresa(empresa_id))', t || '_ver', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (privado.eh_equipe_empresa(empresa_id))', t || '_incluir', t);
    execute format('create policy %I on public.%I for update to authenticated using (privado.eh_equipe_empresa(empresa_id)) with check (privado.eh_equipe_empresa(empresa_id))', t || '_editar', t);
  end loop;
end $$;

-- Certificado digital: a equipe só consulta metadados; gravação apenas pelo servidor (Vault).
create policy certificados_ver on public.certificados_digitais for select to authenticated
  using (privado.eh_equipe_empresa(empresa_id));

create policy municipios_nfse_ver on public.municipios_nfse for select to authenticated using (true);

-- ===========================================================================
-- Auditoria (somente inclusão)
-- ===========================================================================
create policy auditoria_ver on public.registros_auditoria for select to authenticated using (
  (empresa_id is not null and privado.papel_em(empresa_id, 'equipe', 'socio'))
  or (escritorio_id is not null and privado.eh_equipe_escritorio(escritorio_id))
);
create policy auditoria_incluir on public.registros_auditoria for insert to authenticated with check (
  ator_id = (select auth.uid())
  and (
    (empresa_id is not null and privado.papel_na_empresa(empresa_id) is not null)
    or (empresa_id is null and privado.eh_equipe_escritorio(escritorio_id))
  )
);

-- ===========================================================================
-- Storage: bucket privado "documentos"
-- Caminho obrigatório: {escritorio_id}/{empresa_id}/{documento_id}
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 10485760, array[
  'application/pdf', 'image/jpeg', 'image/png', 'application/xml', 'text/xml',
  'text/csv', 'text/plain', 'application/octet-stream'
])
on conflict (id) do nothing;

create or replace function privado.caminho_documento_valido(p_caminho text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_partes text[] := string_to_array(p_caminho, '/');
  v_escritorio uuid;
  v_empresa uuid;
begin
  if array_length(v_partes, 1) <> 3 then return null; end if;
  begin
    v_escritorio := v_partes[1]::uuid;
    v_empresa := v_partes[2]::uuid;
    perform v_partes[3]::uuid;
  exception when invalid_text_representation then
    return null;
  end;
  if not privado.empresa_do_escritorio(v_empresa, v_escritorio) then return null; end if;
  return v_empresa;
end $$;
revoke all on function privado.caminho_documento_valido(text) from public, anon;
grant execute on function privado.caminho_documento_valido(text) to authenticated, service_role;

-- Leitura do arquivo somente se o registro em public.documentos for visível ao usuário.
create policy documentos_arquivo_ler on storage.objects for select to authenticated using (
  bucket_id = 'documentos'
  and exists (select 1 from public.documentos d where d.caminho_storage = storage.objects.name)
);
create policy documentos_arquivo_enviar on storage.objects for insert to authenticated with check (
  bucket_id = 'documentos'
  and privado.papel_em(privado.caminho_documento_valido(name), 'equipe', 'socio', 'financeiro')
);
