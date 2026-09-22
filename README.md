# ContaGiro

Portal de validação de contabilidade self-service para prestadores de serviços do Simples Nacional. A marca substitui Bi2B Simple, preservando a identidade do projeto e os dados existentes.

## Atualização de setembro de 2026

- Identidade dos anexos: logotipo em curvas, favicon, Sora/Inter servidas localmente, azul na navegação e verde para resultados positivos. Medidor usa etapas de fechamento, sem alegar saúde financeira com dados incompletos.
- Matriz por atividade exercida: CNAE, item LC 116, código nacional, municipal e NBS conforme exigência, fundamento, local de incidência e retenção. Primeira confirmação exclusiva do contador; alterações posteriores exigem solicitação do cliente, com histórico antes/depois. Legado escalar bloqueado para atualização.
- Fator R depende de doze meses de receita auferida e folha elegível conferida. Registro de histórico com documento de suporte. Não é uma base universal de enquadramento automático por CNAE.
- Fornecedores/tomadores isolados por empresa, reutilizados nas notas e contas a pagar. A nota congela cadastro, atividade e versão da matriz.
- ISS: órgão público, outro município ou indicação de retenção geram revisão. Sugestão usa componente de ISS do mês anterior, com histórico completo e cenário limitado às quatro primeiras faixas de 2026 dos anexos III/IV/V. Situações fora desse recorte exigem revisão manual. Nunca usa alíquota total do DAS para reter ISS.
- Gestão da carteira: fila consolidada, responsáveis, prazos internos, obrigações, demandas extras, fechamentos, cobranças e acompanhamento comercial. Agenda da contabilidade por mês/empresa, com cores para pendente, concluído e prazo ultrapassado. Cadastros comerciais incompletos são registrados manualmente enquanto o onboarding público não está conectado.
- Cobranças avulsas e contratos mensais. Geração interna por competência sem duplicação, ajuste do dia em meses curtos e pausa de recorrência. Execução agendada, Pix/boleto e confirmação de pagamento exigem provedor.
- Folha: solicitações do cliente; pessoas e pró-labore; referência de matrícula/recibo eSocial; resumo de cálculo externo, líquido aritmético e memória de cálculo; tarefas de acompanhamento eSocial/DCTFWeb/FGTS Digital. Não implementa o motor legal de folha nem transmite obrigações.
- Documentos: pastas mensais e permanentes; pessoais restritos; envio do celular e captura por câmera; arquivo original em R2, hash, versão e relação com versão anterior. Arquivamento/restauração preservam bytes e eventos. Eventos de disponibilização, abertura solicitada, download e ciência por pessoa. Isso não prova leitura integral nem entrega externa; não se alega trilha juridicamente inviolável.
- Outras entradas/receitas: explicação opcional, revisão pelo contador, aviso no portal e alerta de proporção acima dos recebimentos de serviços. Não há inclusão automática na base fiscal; movimentações não tributáveis continuam possíveis. Apuração local fica suspensa nesse cenário.
- Competências adicionais; declaração de ausência de movimentação. DRE gerencial por caixa, análise horizontal, variação com base zero sinalizada, notas determinísticas e exportação CSV arquivada. Nota emitida não é somada novamente ao recebimento. Outras entradas pendentes ficam fora do resultado.
- Matriz contábil opcional: códigos reduzidos, saldos iniciais equilibrados e mapeamento de categorias. Lançamentos preparatórios do extrato, ajustes manuais, revisão individual, balancete e fechamento condicionado ao aceite do serviço extra. Exportador TXT no leiaute Domínio Separador, registros 0000/6000/6100. Separadores e casas decimais conferidos também no arquivo de exemplo do fornecedor. Códigos do destino e importação ainda precisam de homologação no Domínio. O balanço oficial e sua assinatura são concluídos na ferramenta contábil.

## Documentação técnica (comece aqui)

- [docs/LEIA-ME-PROGRAMADOR.md](docs/LEIA-ME-PROGRAMADOR.md): o que é, como rodar, mapa do código, fluxo de uma ação, banco e roteiro de validação.
- [docs/DECISOES.md](docs/DECISOES.md): o que foi feito e por quê.
- [docs/SEGURANCA.md](docs/SEGURANCA.md): acessos, RLS, cofre, cabeçalhos, LGPD e pendências.
- [docs/INTEGRACOES.md](docs/INTEGRACOES.md): SERPRO, PGDAS-D, NFS-e (Nacional e WebISS), Open Finance, CNPJ/CEP e Domínio.

## Arquitetura (setembro de 2026)

O ContaGiro é o ERP do cliente e o portal do escritório; o Domínio continua sendo o centro da apuração e da escrituração.

- **Aplicação:** Next.js 16 (App Router) hospedado na Vercel.
- **Banco, login e arquivos:** Supabase (Postgres com RLS, Auth, Storage privado `documentos` e Vault para segredos).
- **Portais:** `/contador` (exclusivo da equipe do escritório; pode abrir a visão do cliente) e `/cliente` (usuários da empresa, por convite ou pela entrada em 5 etapas em `/comecar`). Página inicial pública em `/`.
- **Regras de negócio:** `lib/domain.ts`, `lib/contagiro.ts` e `lib/reporting.ts` (herdadas, puras e testadas).
- **Tradução para o banco:** `lib/traducao.ts` e `lib/repositorio.ts`; gravação atômica por `public.aplicar_alteracoes`.
- **Migrações:** `supabase/migrations/`.

## Ambientes

| Ambiente | Onde | Observação |
| --- | --- | --- |
| Local | `npm run dev` → http://localhost:3000 | Requer `.env.local` (ver `.env.example`). |
| Homologação | Vercel Preview da branch `homologacao` | Protegido por login da Vercel; Supabase `contagiro-homolog`. |
| Produção | branch `main` | Não publicada nesta fase. |

Comandos: `npm test` (63 testes), `npm run typecheck`, `npm run build`.

## Fontes da implementação

- Marca: anexos contagiro-marca_1.zip e contagiro-guia-identidade_1.html. SVGs do ZIP em curvas são fonte da verdade. Fontes Google Fonts, com licenças OFL em public/fonts.
- Simples / Fator R: https://www8.receita.fazenda.gov.br/simplesnacional/arquivos/manual/perguntaosn.pdf
- LC 123 e tabelas: https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm
- Local de incidência e retenção: https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm
- ISS retido / parcela efetiva: https://normas.receita.fazenda.gov.br/sijut2consulta/anexoOutros.action?idArquivoBinario=54881
- Domínio Separador: https://suporte.dominioatendimento.com/central/faces/solucao.html?codigo=672

Ecossistema próprio. Domínio é somente destino opcional de exportação do serviço contábil adicional; não há integração com Onvio ou gestão externa de tarefas. Comércio e documentos fiscais de mercadorias permanecem fora do escopo.
