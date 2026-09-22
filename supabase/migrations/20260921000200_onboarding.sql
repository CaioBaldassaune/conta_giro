-- Entrada de novos clientes pela página inicial (5 etapas) e planos.
--
-- Etapas: 1) quem é o cliente  2) plano (Essencial, Gestão, Estratégia)  3) pagamento e
-- contrato (em espera)  4) procurações no e-CAC (cliente)  5) grade tributária (contador).
-- Ao terminar a etapa 4 o cliente já entra no aplicativo; a 5 fica com o escritório.

-- Endereço da empresa (pagador no Open Finance, nota fiscal) e plano contratado.
alter table public.empresas
  add column cep char(8) check (cep ~ '^\d{8}$'),
  add column logradouro text check (length(logradouro) <= 125),
  add column numero text check (length(numero) <= 10),
  add column complemento text check (length(complemento) <= 60),
  add column bairro text check (length(bairro) <= 60),
  add column plano text check (plano in ('essencial', 'gestao', 'estrategia')),
  add column origem text not null default 'carteira' check (origem in ('carteira', 'autocadastro'));

-- Andamento da entrada de cada pessoa. Uma linha por usuário: o cliente pode sair e voltar.
create table public.onboardings (
  usuario_id uuid primary key references auth.users (id) on delete cascade,
  empresa_id uuid references public.empresas (id) on delete set null,
  escritorio_id uuid not null references public.escritorios (id) on delete restrict,
  etapa smallint not null default 1 check (etapa between 1 and 5),
  plano text check (plano in ('essencial', 'gestao', 'estrategia')),
  responsavel_nome text check (length(responsavel_nome) <= 120),
  responsavel_telefone text check (length(responsavel_telefone) <= 30),
  aceite_termos_em timestamptz,            -- etapa 3 em espera: só o aceite dos termos de uso
  procuracao_informada_em timestamptz,     -- etapa 4: cliente declarou que outorgou a procuração
  grade_concluida_em timestamptz,          -- etapa 5: contador confirmou a matriz tributária
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index onboardings_empresa_idx on public.onboardings (empresa_id);
create index onboardings_escritorio_idx on public.onboardings (escritorio_id);
alter table public.onboardings enable row level security;
-- O próprio usuário vê o seu andamento; a equipe do escritório vê todos os do escritório.
-- Gravação só pelo servidor (service_role), que valida cada etapa.
create policy onboardings_ver on public.onboardings for select to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.eh_equipe_escritorio(escritorio_id)));
