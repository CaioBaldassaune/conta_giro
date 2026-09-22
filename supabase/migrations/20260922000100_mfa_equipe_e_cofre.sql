-- Segurança máxima para quem enxerga certificados e dados de todos os clientes (a equipe).
--
-- 1) Verificação em duas etapas (TOTP) OBRIGATÓRIA para a equipe do escritório, imposta pelo
--    BANCO: as funções que dão poder de equipe só respondem "sim" com sessão aal2 (senha +
--    código do aplicativo autenticador). Uma senha vazada, sozinha, não lê nada da carteira —
--    nem pelo app, nem chamando a API do Supabase diretamente.
-- 2) public.sou_equipe(): responde só "esta pessoa é da equipe?", para o proxy mandar o
--    contador ao cadastro/validação do segundo fator antes de qualquer tela.
-- 3) Registro de toda leitura de segredo do cofre (certificados A1, senhas, tokens).

create or replace function privado.sessao_com_mfa()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
$$;
revoke all on function privado.sessao_com_mfa() from public, anon;
grant execute on function privado.sessao_com_mfa() to authenticated, service_role;

create or replace function privado.eh_equipe_escritorio(p_escritorio uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select privado.sessao_com_mfa() and exists (
    select 1 from public.membros_escritorio
    where escritorio_id = p_escritorio and usuario_id = (select auth.uid())
  );
$$;

create or replace function privado.eh_titular_escritorio(p_escritorio uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select privado.sessao_com_mfa() and exists (
    select 1 from public.membros_escritorio
    where escritorio_id = p_escritorio and usuario_id = (select auth.uid()) and papel = 'titular'
  );
$$;

-- 'equipe' só com o segundo fator validado; o papel de cliente não muda.
create or replace function privado.papel_na_empresa(p_empresa uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when privado.sessao_com_mfa() and exists (
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

create or replace function public.sou_equipe()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros_escritorio where usuario_id = (select auth.uid()));
$$;
revoke all on function public.sou_equipe() from public, anon;
grant execute on function public.sou_equipe() to authenticated;

-- Trilha de leitura do cofre. Fica no schema privado (fora da API).
create table privado.leituras_cofre (
  id bigint generated always as identity primary key,
  segredo_id uuid not null,
  nome text,
  lido_em timestamptz not null default now()
);

create or replace function privado.ler_segredo(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_valor text;
  v_nome text;
begin
  select decrypted_secret, name into v_valor, v_nome from vault.decrypted_secrets where id = p_id;
  -- Nome sem o sufixo aleatório: guarda o tipo e a empresa (ex.: certificado:<empresa>:pfx).
  insert into privado.leituras_cofre (segredo_id, nome) values (p_id, regexp_replace(coalesce(v_nome, ''), ':[0-9a-f-]{36}$', ''));
  return v_valor;
end $$;
revoke all on function privado.ler_segredo(uuid) from public, anon, authenticated;
grant execute on function privado.ler_segredo(uuid) to service_role;
