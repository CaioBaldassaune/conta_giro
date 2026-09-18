-- ContaGiro • Operação do cliente: documentos, solicitações, matriz tributária,
-- competências, cadastros, notas fiscais e movimentações.

-- ---------------------------------------------------------------------------
-- Documentos (arquivo original no Storage, bucket "documentos")
-- ---------------------------------------------------------------------------
create table public.documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  escopo text not null check (escopo in ('mensal', 'permanente')),
  competencia public.competencia_mes,
  categoria text not null check (categoria in (
    'mensal', 'extrato_bancario', 'nota_fiscal', 'xml_nfse', 'tributos', 'outros',
    'societario', 'pessoal', 'folha', 'notificacao'
  )),
  nome text not null check (length(nome) between 1 and 180),
  caminho_storage text not null unique,
  tamanho_bytes bigint not null check (tamanho_bytes > 0),
  tipo_mime text not null,
  sha256 char(64) not null,
  versao integer not null default 1 check (versao >= 1),
  documento_anterior_id uuid references public.documentos (id) on delete restrict,
  tipo_exportacao text,
  versao_origem integer,
  enviado_por uuid references auth.users (id) on delete set null,
  enviado_por_email text,
  enviado_em timestamptz not null default now(),
  arquivado_em timestamptz,
  arquivado_por uuid references auth.users (id) on delete set null,
  check ((escopo = 'permanente') = (competencia is null))
);
create index documentos_empresa_competencia_idx on public.documentos (empresa_id, competencia);
create index documentos_anterior_idx on public.documentos (documento_anterior_id);
create index documentos_enviado_por_idx on public.documentos (enviado_por);
create index documentos_arquivado_por_idx on public.documentos (arquivado_por);
-- Uma única versão seguinte por documento (evita ramificação de versões).
create unique index documentos_proxima_versao_unica on public.documentos (documento_anterior_id) where documento_anterior_id is not null;

create table public.eventos_documento (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.documentos (id) on delete restrict,
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  evento text not null check (evento in (
    'enviado', 'gerado', 'abertura_solicitada', 'download_solicitado', 'ciencia',
    'arquivado', 'restaurado', 'entrega_externa_informada', 'enviado_dominio'
  )),
  ator_id uuid references auth.users (id) on delete set null,
  ator_email text,
  detalhe text not null default '',
  ocorrido_em timestamptz not null default now()
);
create index eventos_documento_documento_idx on public.eventos_documento (documento_id, ocorrido_em);
create index eventos_documento_empresa_idx on public.eventos_documento (empresa_id);
create index eventos_documento_ator_idx on public.eventos_documento (ator_id);
comment on table public.eventos_documento is 'Histórico somente de inclusão. Não prova leitura integral nem entrega externa.';

create table public.ciencias_documento (
  documento_id uuid not null references public.documentos (id) on delete restrict,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  usuario_email text not null,
  ciente_em timestamptz not null default now(),
  primary key (documento_id, usuario_id)
);
create index ciencias_documento_usuario_idx on public.ciencias_documento (usuario_id);

-- ---------------------------------------------------------------------------
-- Solicitações do cliente (inclui orçamento de serviço extra)
-- ---------------------------------------------------------------------------
create table public.solicitacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  competencia public.competencia_mes not null,
  titulo text not null check (length(titulo) between 1 and 180),
  descricao text not null check (length(descricao) <= 2000),
  tipo text not null,
  categoria text not null default 'geral' check (categoria in ('geral', 'alteracao_tributaria', 'folha', 'servico_extra')),
  situacao text not null default 'recebida' check (situacao in ('recebida', 'em_atendimento', 'aguardando_aceite', 'orcamento_aceito', 'concluida')),
  responsavel text,
  prazo date,
  valor_orcamento bigint check (valor_orcamento > 0),
  escopo_orcamento text,
  aceito_em timestamptz,
  solicitado_por uuid references auth.users (id) on delete set null,
  solicitado_por_email text,
  evidencia_solicitacao text,
  aplicado_em timestamptz,
  versao_matriz_aplicada integer,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index solicitacoes_empresa_idx on public.solicitacoes (empresa_id, competencia);
create index solicitacoes_solicitado_por_idx on public.solicitacoes (solicitado_por);
create trigger solicitacoes_atualizado_em before update on public.solicitacoes
  for each row execute function privado.definir_atualizado_em();

-- ---------------------------------------------------------------------------
-- Matriz tributária por atividade (versionada)
-- ---------------------------------------------------------------------------
create table public.versoes_matriz_tributaria (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  versao integer not null check (versao >= 1),
  regime_apuracao text not null check (regime_apuracao in ('caixa', 'competencia')),
  municipio text not null,
  anexo_principal text not null check (anexo_principal in ('III', 'IV', 'V')),
  fator_r boolean not null default false,
  vigencia_inicio public.competencia_mes not null,
  confirmado_por uuid references auth.users (id) on delete set null,
  confirmado_por_email text,
  confirmado_em timestamptz not null default now(),
  solicitacao_id uuid references public.solicitacoes (id) on delete restrict,
  retrato_anterior jsonb,
  unique (empresa_id, versao)
);
create index versoes_matriz_solicitacao_idx on public.versoes_matriz_tributaria (solicitacao_id);
create index versoes_matriz_confirmado_por_idx on public.versoes_matriz_tributaria (confirmado_por);
comment on table public.versoes_matriz_tributaria is 'Cada confirmação do contador gera nova versão; a vigente é a de maior número.';

create table public.atividades_empresa (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  versao_matriz_id uuid not null references public.versoes_matriz_tributaria (id) on delete restrict,
  cnae char(7) not null check (cnae ~ '^\d{7}$'),
  descricao text not null,
  anexo text not null check (anexo in ('III', 'IV', 'V', 'fator_r')),
  item_lc116 text not null check (item_lc116 ~ '^\d{2}\.\d{2}$'),
  codigo_tributacao_nacional char(6) not null check (codigo_tributacao_nacional ~ '^\d{6}$'),
  exige_codigo_municipal boolean not null default false,
  codigo_municipal text,
  exige_nbs boolean not null default false,
  nbs text,
  fundamento text not null,
  regra_iss text not null,
  ordem integer not null default 0,
  check (not exige_codigo_municipal or coalesce(codigo_municipal, '') <> ''),
  check (not exige_nbs or coalesce(nbs, '') <> '')
);
create index atividades_empresa_versao_idx on public.atividades_empresa (versao_matriz_id);
create index atividades_empresa_empresa_idx on public.atividades_empresa (empresa_id);

-- Receita auferida e folha elegível por mês (base do Fator R e da estimativa do DAS).
create table public.historico_receitas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  competencia public.competencia_mes not null,
  receita bigint not null check (receita >= 0),
  folha bigint check (folha >= 0),
  folha_validada boolean not null default false,
  fonte text not null,
  documento_evidencia_id uuid references public.documentos (id) on delete restrict,
  validado_por uuid references auth.users (id) on delete set null,
  validado_por_email text,
  validado_em timestamptz,
  unique (empresa_id, competencia)
);
create index historico_receitas_documento_idx on public.historico_receitas (documento_evidencia_id);
create index historico_receitas_validado_por_idx on public.historico_receitas (validado_por);

-- ---------------------------------------------------------------------------
-- Competências (fechamento mensal)
-- ---------------------------------------------------------------------------
create table public.competencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  competencia public.competencia_mes not null,
  situacao text not null default 'aberta' check (situacao in ('aberta', 'enviada', 'revisada', 'aprovada')),
  extratos_confirmados boolean not null default false,
  receitas_confirmadas boolean not null default false,
  sem_movimento boolean not null default false,
  ultimo_lote jsonb,
  retrato jsonb,
  retrato_anterior jsonb,
  enviada_em timestamptz,
  revisada_em timestamptz,
  parecer_revisao text,
  aprovada_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, competencia)
);
create trigger competencias_atualizado_em before update on public.competencias
  for each row execute function privado.definir_atualizado_em();

-- ---------------------------------------------------------------------------
-- Fornecedores e tomadores
-- ---------------------------------------------------------------------------
create table public.contatos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  nome text not null check (length(nome) between 1 and 180),
  tipo text not null check (tipo in ('fornecedor', 'tomador', 'ambos')),
  cpf_cnpj text check (cpf_cnpj ~ '^(\d{11}|\d{14})$'),
  email text,
  telefone text,
  municipio text not null,
  codigo_ibge char(7) check (codigo_ibge ~ '^\d{7}$'),
  endereco text,
  inscricao_municipal text,
  orgao_publico boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index contatos_empresa_idx on public.contatos (empresa_id);
create unique index contatos_documento_por_empresa on public.contatos (empresa_id, cpf_cnpj) where cpf_cnpj is not null;
create trigger contatos_atualizado_em before update on public.contatos
  for each row execute function privado.definir_atualizado_em();

-- ---------------------------------------------------------------------------
-- Notas fiscais de serviço (rascunho no portal, capturadas via API ou XML)
-- ---------------------------------------------------------------------------
create table public.notas_fiscais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  competencia public.competencia_mes not null,
  origem text not null default 'rascunho_portal' check (origem in ('rascunho_portal', 'captura_adn', 'importacao_xml')),
  papel_empresa text not null default 'prestador' check (papel_empresa in ('prestador', 'tomador')),
  numero text,
  chave_acesso text,
  codigo_verificacao text,
  nsu bigint,
  prestador_cpf_cnpj text,
  prestador_nome text,
  tomador_id uuid references public.contatos (id) on delete restrict,
  tomador_cpf_cnpj text,
  tomador_nome text not null,
  tomador_retrato jsonb,
  descricao_servico text not null check (length(descricao_servico) <= 2000),
  data_servico date,
  local_prestacao text,
  codigo_ibge_incidencia char(7),
  atividade_id uuid references public.atividades_empresa (id) on delete restrict,
  atividade_retrato jsonb,
  versao_matriz integer,
  item_lc116 text,
  codigo_tributacao_nacional text,
  valor_servicos bigint not null check (valor_servicos > 0),
  valor_deducoes bigint not null default 0,
  valor_liquido bigint,
  vencimento date,
  iss_retido boolean not null default false,
  situacao_iss text not null default 'nao_indicado' check (situacao_iss in ('nao_indicado', 'pendente_revisao', 'revisado')),
  aliquota_iss numeric(7, 4) check (aliquota_iss between 0 and 0.05),
  valor_iss bigint not null default 0,
  sugestao_iss jsonb,
  revisao_iss jsonb,
  situacao text not null default 'rascunho' check (situacao in ('rascunho', 'simulada', 'autorizada', 'cancelada', 'substituida')),
  emitida_em timestamptz,
  documento_xml_id uuid references public.documentos (id) on delete restrict,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index notas_fiscais_empresa_competencia_idx on public.notas_fiscais (empresa_id, competencia);
create unique index notas_fiscais_chave_por_empresa on public.notas_fiscais (empresa_id, chave_acesso) where chave_acesso is not null;
create index notas_fiscais_tomador_idx on public.notas_fiscais (tomador_id);
create index notas_fiscais_atividade_idx on public.notas_fiscais (atividade_id);
create index notas_fiscais_documento_xml_idx on public.notas_fiscais (documento_xml_id);
create trigger notas_fiscais_atualizado_em before update on public.notas_fiscais
  for each row execute function privado.definir_atualizado_em();

-- ---------------------------------------------------------------------------
-- Contas bancárias, movimentações e regras de classificação
-- ---------------------------------------------------------------------------
create table public.contas_bancarias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  nome text not null check (length(nome) between 1 and 80),
  nome_normalizado text not null,
  banco text,
  agencia text,
  numero text,
  criado_em timestamptz not null default now(),
  unique (empresa_id, nome_normalizado)
);

create table public.movimentacoes_bancarias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  competencia public.competencia_mes not null,
  conta_bancaria_id uuid not null references public.contas_bancarias (id) on delete restrict,
  data date not null,
  descricao text not null,
  valor bigint not null check (valor <> 0),
  categoria text check (categoria in (
    'receita_servicos', 'outras_entradas', 'aluguel', 'software', 'telecom', 'tributos',
    'pessoal', 'tarifas_bancarias', 'outras_despesas', 'custo_servicos', 'transferencia',
    'emprestimo_aporte', 'estorno_ajuste'
  )),
  nota_fiscal_id uuid references public.notas_fiscais (id) on delete restrict,
  justificativa text,
  precisa_revisao boolean not null default false,
  classificado_em timestamptz,
  natureza_outras text check (natureza_outras in ('servico', 'operacional', 'financeira', 'nao_receita')),
  parecer_outras text,
  revisado_outras_por text,
  revisado_outras_em timestamptz,
  arquivo_origem text,
  hash_arquivo char(64),
  linha_arquivo integer,
  fit_id text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (categoria is null or (categoria in ('receita_servicos', 'outras_entradas') and valor > 0)
    or (categoria in ('aluguel', 'software', 'telecom', 'tributos', 'pessoal', 'tarifas_bancarias', 'outras_despesas', 'custo_servicos') and valor < 0)
    or categoria in ('transferencia', 'emprestimo_aporte', 'estorno_ajuste'))
);
create index movimentacoes_empresa_competencia_idx on public.movimentacoes_bancarias (empresa_id, competencia);
create index movimentacoes_conta_idx on public.movimentacoes_bancarias (conta_bancaria_id);
create index movimentacoes_nota_idx on public.movimentacoes_bancarias (nota_fiscal_id);
-- Evita importar duas vezes o mesmo lançamento bancário.
create unique index movimentacoes_fit_unico on public.movimentacoes_bancarias (conta_bancaria_id, fit_id) where fit_id is not null;
create unique index movimentacoes_linha_unica on public.movimentacoes_bancarias (conta_bancaria_id, hash_arquivo, linha_arquivo) where fit_id is null and hash_arquivo is not null;
create trigger movimentacoes_atualizado_em before update on public.movimentacoes_bancarias
  for each row execute function privado.definir_atualizado_em();

create table public.regras_classificacao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  padrao text not null check (length(padrao) >= 6),
  categoria text not null,
  ativa boolean not null default true,
  modo text not null default 'sugerir' check (modo in ('sugerir')),
  criado_em timestamptz not null default now(),
  unique (empresa_id, padrao)
);

-- ---------------------------------------------------------------------------
-- Contas a pagar
-- ---------------------------------------------------------------------------
create table public.contas_pagar (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  competencia public.competencia_mes not null,
  descricao text not null,
  valor bigint not null check (valor > 0),
  vencimento date not null,
  categoria text not null,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'pagamento_informado', 'pagamento_confirmado')),
  fornecedor_id uuid references public.contatos (id) on delete restrict,
  fornecedor_retrato jsonb,
  informado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index contas_pagar_empresa_idx on public.contas_pagar (empresa_id, competencia);
create index contas_pagar_fornecedor_idx on public.contas_pagar (fornecedor_id);

-- ---------------------------------------------------------------------------
-- Notificações do portal
-- ---------------------------------------------------------------------------
create table public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  competencia public.competencia_mes not null,
  titulo text not null,
  corpo text not null,
  publico text not null default 'cliente' check (publico in ('cliente', 'escritorio')),
  canal text not null default 'portal' check (canal in ('portal', 'email')),
  origem_id uuid,
  documento_id uuid references public.documentos (id) on delete restrict,
  criado_em timestamptz not null default now()
);
create index notificacoes_empresa_idx on public.notificacoes (empresa_id, competencia);
create index notificacoes_documento_idx on public.notificacoes (documento_id);

create table public.leituras_notificacao (
  notificacao_id uuid not null references public.notificacoes (id) on delete cascade,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  lida_em timestamptz not null default now(),
  primary key (notificacao_id, usuario_id)
);
create index leituras_notificacao_usuario_idx on public.leituras_notificacao (usuario_id);
