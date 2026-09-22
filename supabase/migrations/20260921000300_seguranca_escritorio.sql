-- Separação de acessos: cliente não vira "contador".
--
-- Com o autocadastro de clientes pela página inicial, qualquer pessoa pode ter uma conta.
-- criar_escritorio (SECURITY DEFINER, chamável por usuários logados) deixaria um cliente criar
-- um escritório próprio e abrir o painel do contador. Regras novas:
--   1) quem já é cliente (membro de alguma empresa) ou já está em um escritório não cria outro;
--   2) no MVP há um único escritório: depois do primeiro, novos contadores entram por convite
--      do titular (membros_escritorio), não criando escritórios.
create or replace function public.criar_escritorio(p_nome text, p_cnpj text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Entre com sua conta para criar o escritório.' using errcode = '42501';
  end if;
  if exists (select 1 from public.membros_empresa where usuario_id = (select auth.uid()))
     or exists (select 1 from public.membros_escritorio where usuario_id = (select auth.uid())) then
    raise exception 'Esta conta já tem acesso (cliente ou escritório) e não pode criar um escritório.' using errcode = '42501';
  end if;
  if exists (select 1 from public.escritorios) then
    raise exception 'O escritório já está cadastrado. Peça ao titular para incluir você na equipe.' using errcode = '42501';
  end if;
  insert into public.escritorios (nome, cnpj, criado_por)
  values (trim(p_nome), nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), ''), (select auth.uid()))
  returning id into v_id;
  insert into public.membros_escritorio (escritorio_id, usuario_id, papel)
  values (v_id, (select auth.uid()), 'titular');
  return v_id;
end $$;
revoke all on function public.criar_escritorio(text, text) from public, anon;
grant execute on function public.criar_escritorio(text, text) to authenticated;
