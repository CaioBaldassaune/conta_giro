-- ContaGiro • Controle de procuração no e-CAC por empresa (SERPRO Integra Contador).
--
-- Quando o SERPRO responde "sem procuração" (ICGERENCIADOR-022/032), a empresa fica
-- com procuração PENDENTE e novas chamadas cobradas são bloqueadas no ContaGiro —
-- o SERPRO cobra também as respostas 403. A verificação é refeita com a Caixa Postal
-- (Monitorar, não cobrada). Gravação somente pelo servidor.

create table public.procuracoes_serpro (
  empresa_id uuid primary key references public.empresas (id) on delete restrict,
  situacao text not null check (situacao in ('pendente', 'ativa')),
  servico_negado text,
  mensagem text,
  verificada_em timestamptz not null default now()
);
alter table public.procuracoes_serpro enable row level security;
create policy procuracoes_serpro_ver on public.procuracoes_serpro for select to authenticated
  using (privado.eh_equipe_empresa(empresa_id));

-- O painel passa a mostrar a procuração pendente (muda o retorno: recria a função).
drop function public.painel_carteira(text);
create function public.painel_carteira(p_competencia text)
returns table (
  empresa_id uuid, razao_social text, cnpj text, ativa boolean, matriz_confirmada boolean,
  competencia_situacao text, extratos_confirmados boolean, receitas_confirmadas boolean, sem_movimento boolean,
  lancamentos_pendentes integer, receitas_sem_vinculo integer, outras_entradas_pendentes integer, notas_rascunho integer,
  documentos_mes integer, chamados_abertos integer, chamados_aguardando_escritorio integer, chamado_mais_antigo timestamptz,
  tarefas_atrasadas integer, cobrancas_vencidas integer, pgdas_transmitida boolean, das_pago boolean, das_vencimento date,
  caixa_postal_novas integer, situacao_fiscal text, fiscal_atualizado_em timestamptz,
  procuracao_pendente boolean, procuracao_mensagem text
) language sql stable security invoker set search_path = '' as $$
  select
    e.id, e.razao_social, e.cnpj, e.ativa,
    exists (select 1 from public.versoes_matriz_tributaria v where v.empresa_id = e.id and v.confirmado_por_email is not null),
    c.situacao, c.extratos_confirmados, c.receitas_confirmadas, c.sem_movimento,
    (select count(*)::int from public.movimentacoes_bancarias m
      where m.empresa_id = e.id and m.competencia = p_competencia and (m.categoria is null or m.precisa_revisao)),
    (select count(*)::int from public.movimentacoes_bancarias m
      where m.empresa_id = e.id and m.competencia = p_competencia and m.categoria = 'receita_servicos'
        and m.nota_fiscal_id is null and m.justificativa is null),
    (select count(*)::int from public.movimentacoes_bancarias m
      where m.empresa_id = e.id and m.competencia = p_competencia and m.categoria = 'outras_entradas' and m.natureza_outras is null),
    (select count(*)::int from public.notas_fiscais n
      where n.empresa_id = e.id and n.competencia = p_competencia and n.situacao = 'rascunho'),
    (select count(*)::int from public.documentos d
      where d.empresa_id = e.id and d.competencia = p_competencia and d.arquivado_em is null),
    (select count(*)::int from public.solicitacoes s where s.empresa_id = e.id and s.situacao <> 'concluida'),
    (select count(*)::int from public.solicitacoes s
      where s.empresa_id = e.id and s.situacao <> 'concluida' and s.aguardando = 'escritorio'),
    (select min(s.criado_em) from public.solicitacoes s where s.empresa_id = e.id and s.situacao <> 'concluida'),
    (select count(*)::int from public.tarefas t
      where t.empresa_id = e.id and t.situacao <> 'concluida' and t.prazo < current_date),
    (select count(*)::int from public.cobrancas b
      where b.empresa_id = e.id and b.situacao = 'pendente' and b.vencimento < current_date),
    f.pgdas_transmitida, f.das_pago, f.das_vencimento, f.caixa_postal_novas, f.situacao_fiscal, f.atualizado_em,
    coalesce(pr.situacao = 'pendente', false), pr.mensagem
  from public.empresas e
  left join public.competencias c on c.empresa_id = e.id and c.competencia = p_competencia
  left join public.situacoes_fiscais f on f.empresa_id = e.id and f.competencia = p_competencia
  left join public.procuracoes_serpro pr on pr.empresa_id = e.id
  where privado.eh_equipe_escritorio(e.escritorio_id)
  order by e.razao_social;
$$;
revoke all on function public.painel_carteira(text) from public, anon;
grant execute on function public.painel_carteira(text) to authenticated;
