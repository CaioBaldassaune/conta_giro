-- ContaGiro • Gestão do escritório, folha, contabilidade e auditoria.

-- ---------------------------------------------------------------------------
-- Tarefas e obrigações (pertencem ao escritório; empresa é opcional)
-- ---------------------------------------------------------------------------
create table public.tarefas (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios (id) on delete restrict,
  empresa_id uuid references public.empresas (id) on delete restrict,
  competencia public.competencia_mes,
  titulo text not null check (length(titulo) between 1 and 180),
  descricao text not null default '' check (length(descricao) <= 1000),
  categoria text not null default 'Entrega',
  responsavel_id uuid references auth.users (id) on delete set null,
  responsavel_nome text not null,
  prazo date not null,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'em_andamento', 'concluida')),
  concluida_em timestamptz,
  evidencia text,
  origem_tipo text,
  origem_id uuid,
  solicitacao_id uuid references public.solicitacoes (id) on delete restrict,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (situacao <> 'concluida' or coalesce(evidencia, '') <> '')
);
create index tarefas_escritorio_prazo_idx on public.tarefas (escritorio_id, prazo);
create index tarefas_empresa_idx on public.tarefas (empresa_id, competencia);
create index tarefas_responsavel_idx on public.tarefas (responsavel_id);
create index tarefas_solicitacao_idx on public.tarefas (solicitacao_id);
create unique index tarefas_origem_unica on public.tarefas (origem_tipo, origem_id) where origem_id is not null;
create trigger tarefas_atualizado_em before update on public.tarefas
  for each row execute function privado.definir_atualizado_em();

-- ---------------------------------------------------------------------------
-- Comercial e cobrança do escritório
-- ---------------------------------------------------------------------------
create table public.leads_comerciais (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios (id) on delete restrict,
  nome text not null,
  email text not null check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  pacote text not null,
  situacao text not null default 'incompleto' check (situacao in ('incompleto', 'contatado', 'convertido', 'perdido')),
  observacao text,
  responsavel text not null default 'Comercial',
  origem text not null default 'Registro manual',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index leads_comerciais_escritorio_idx on public.leads_comerciais (escritorio_id);
create trigger leads_comerciais_atualizado_em before update on public.leads_comerciais
  for each row execute function privado.definir_atualizado_em();

create table public.assinaturas (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios (id) on delete restrict,
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  descricao text not null,
  valor bigint not null check (valor > 0),
  competencia_inicio public.competencia_mes not null,
  dia_vencimento smallint not null check (dia_vencimento between 1 and 31),
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);
create index assinaturas_escritorio_idx on public.assinaturas (escritorio_id);
create index assinaturas_empresa_idx on public.assinaturas (empresa_id);

create table public.cobrancas (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios (id) on delete restrict,
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  competencia public.competencia_mes not null,
  descricao text not null,
  valor bigint not null check (valor > 0),
  vencimento date not null,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'pagamento_informado', 'pagamento_confirmado', 'cancelada')),
  origem text not null check (origem in ('avulsa', 'assinatura', 'servico_extra')),
  assinatura_id uuid references public.assinaturas (id) on delete restrict,
  solicitacao_id uuid references public.solicitacoes (id) on delete restrict,
  provedor text not null default 'nao_conectado',
  informado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index cobrancas_escritorio_idx on public.cobrancas (escritorio_id, competencia);
create index cobrancas_empresa_idx on public.cobrancas (empresa_id, competencia);
create index cobrancas_solicitacao_idx on public.cobrancas (solicitacao_id);
-- Geração recorrente nunca duplica a cobrança do mês.
create unique index cobrancas_assinatura_mes_unica on public.cobrancas (assinatura_id, competencia) where assinatura_id is not null;

-- ---------------------------------------------------------------------------
-- Folha e pró-labore (dados sensíveis: equipe e sócio)
-- ---------------------------------------------------------------------------
create table public.colaboradores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  nome text not null,
  tipo text not null check (tipo in ('empregado', 'pro_labore')),
  cargo text not null,
  remuneracao bigint not null check (remuneracao >= 0),
  inicio date not null,
  matricula_esocial text,
  situacao text not null default 'ativo' check (situacao in ('ativo', 'inativo')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index colaboradores_empresa_idx on public.colaboradores (empresa_id);
create trigger colaboradores_atualizado_em before update on public.colaboradores
  for each row execute function privado.definir_atualizado_em();

create table public.folhas_pagamento (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  competencia public.competencia_mes not null,
  proventos bigint not null check (proventos >= 0),
  descontos bigint not null check (descontos >= 0),
  encargos bigint not null check (encargos >= 0),
  liquido bigint generated always as (proventos - descontos) stored,
  situacao text not null default 'rascunho' check (situacao in ('rascunho', 'revisada')),
  fonte text not null default 'Cálculo externo informado pelo contador',
  documento_evidencia_id uuid references public.documentos (id) on delete restrict,
  observacao text not null,
  registrado_por text not null,
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, competencia),
  check (descontos <= proventos),
  check (situacao <> 'revisada' or documento_evidencia_id is not null)
);
create index folhas_pagamento_documento_idx on public.folhas_pagamento (documento_evidencia_id);
create trigger folhas_pagamento_atualizado_em before update on public.folhas_pagamento
  for each row execute function privado.definir_atualizado_em();

-- ---------------------------------------------------------------------------
-- Contabilidade (serviço extra) e exportação para o Domínio
-- ---------------------------------------------------------------------------
create table public.configuracoes_contabeis (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null unique references public.empresas (id) on delete restrict,
  versao integer not null default 1,
  competencia_inicial public.competencia_mes not null,
  conta_banco_codigo text not null,
  cnpj_destino char(14) not null check (cnpj_destino ~ '^\d{14}$'),
  filial text,
  confirmado_por text not null,
  atualizado_em timestamptz not null default now()
);

create table public.plano_contas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  configuracao_id uuid not null references public.configuracoes_contabeis (id) on delete cascade,
  codigo text not null check (codigo ~ '^\d{1,12}$'),
  nome text not null,
  grupo text not null check (grupo in ('ativo', 'passivo', 'patrimonio_liquido', 'receita', 'despesa')),
  saldo_inicial bigint not null default 0,
  unique (empresa_id, codigo)
);
create index plano_contas_configuracao_idx on public.plano_contas (configuracao_id);

create table public.mapeamentos_categoria_conta (
  configuracao_id uuid not null references public.configuracoes_contabeis (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  categoria text not null,
  conta_codigo text not null,
  primary key (configuracao_id, categoria),
  foreign key (empresa_id, conta_codigo) references public.plano_contas (empresa_id, codigo) on delete restrict
);
create index mapeamentos_empresa_conta_idx on public.mapeamentos_categoria_conta (empresa_id, conta_codigo);

create table public.lancamentos_contabeis (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  competencia public.competencia_mes not null,
  data date not null,
  conta_debito text not null,
  conta_credito text not null,
  valor bigint not null check (valor > 0),
  historico text not null check (length(historico) <= 500),
  movimentacao_id uuid references public.movimentacoes_bancarias (id) on delete restrict,
  retrato_origem jsonb,
  versao_configuracao integer not null,
  situacao text not null default 'rascunho' check (situacao in ('rascunho', 'validado')),
  validado_por text,
  validado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (conta_debito <> conta_credito),
  foreign key (empresa_id, conta_debito) references public.plano_contas (empresa_id, codigo) on delete restrict,
  foreign key (empresa_id, conta_credito) references public.plano_contas (empresa_id, codigo) on delete restrict
);
create index lancamentos_empresa_competencia_idx on public.lancamentos_contabeis (empresa_id, competencia);
create index lancamentos_debito_idx on public.lancamentos_contabeis (empresa_id, conta_debito);
create index lancamentos_credito_idx on public.lancamentos_contabeis (empresa_id, conta_credito);
create unique index lancamentos_movimentacao_unica on public.lancamentos_contabeis (movimentacao_id) where movimentacao_id is not null;
create trigger lancamentos_atualizado_em before update on public.lancamentos_contabeis
  for each row execute function privado.definir_atualizado_em();

create table public.fechamentos_contabeis (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  competencia public.competencia_mes not null,
  situacao text not null default 'aberto' check (situacao in ('aberto', 'revisado')),
  revisado_em timestamptz,
  revisado_por text,
  parecer text,
  solicitacao_id uuid references public.solicitacoes (id) on delete restrict,
  retrato jsonb,
  reaberto_em timestamptz,
  motivo_reabertura text,
  unique (empresa_id, competencia)
);
create index fechamentos_solicitacao_idx on public.fechamentos_contabeis (solicitacao_id);

-- ---------------------------------------------------------------------------
-- Auditoria (somente inclusão)
-- ---------------------------------------------------------------------------
create table public.registros_auditoria (
  id bigint generated always as identity primary key,
  escritorio_id uuid references public.escritorios (id) on delete restrict,
  empresa_id uuid references public.empresas (id) on delete restrict,
  ator_id uuid references auth.users (id) on delete set null,
  ator_email text not null,
  acao text not null,
  detalhe text not null,
  criado_em timestamptz not null default now(),
  check (escritorio_id is not null or empresa_id is not null)
);
create index registros_auditoria_empresa_idx on public.registros_auditoria (empresa_id, criado_em desc);
create index registros_auditoria_escritorio_idx on public.registros_auditoria (escritorio_id, criado_em desc);
create index registros_auditoria_ator_idx on public.registros_auditoria (ator_id);
