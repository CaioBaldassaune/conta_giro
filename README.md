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

## Arquitetura (setembro de 2026)

O ContaGiro é o ERP do cliente e o portal do escritório; o Domínio continua sendo o centro da apuração e da escrituração.

- **Aplicação:** Next.js 16 (App Router) hospedado na Vercel.
- **Banco, login e arquivos:** Supabase (Postgres com RLS, Auth e Storage, bucket privado `documentos`).
- **Portais:** `/contador` (equipe do escritório; o primeiro acesso cadastra o escritório) e `/cliente` (usuários da empresa; acesso somente por convite com token de uso único).
- **Regras de negócio:** `lib/domain.ts`, `lib/contagiro.ts` e `lib/reporting.ts`, inalteradas.
- **Tradução para o banco:** `lib/traducao.ts` converte os registros das regras para as tabelas normalizadas em português e de volta; `lib/repositorio.ts` carrega e grava.
- **Gravação:** cada ação é gravada de forma atômica por `public.aplicar_alteracoes` (RLS do usuário, trava otimista por empresa e auditoria). Em conflito, o servidor recarrega e reaplica a regra.
- **Migrações:** `supabase/migrations/`.

## Ambientes

| Ambiente | Onde | Observação |
| --- | --- | --- |
| Local | `npm run dev` → http://localhost:3000 | Requer `.env.local` (ver `.env.example`). |
| Homologação | Vercel Preview da branch `homologacao` | Protegido por login da Vercel; Supabase `contagiro-homolog`. |
| Produção | branch `main` | Ainda não publicada para uso. |

Comandos: `npm test` (regras e tradução), `npm run typecheck`, `npm run build`.

## Limitações operacionais explícitas

Nenhuma integração oficial foi conectada: NFS-e, Integra Contador, DAS, situação fiscal, parcelamentos, cobrança, e-mail/push, Open Finance e folha oficial. Mensagens existem no portal. Captura de câmera depende do navegador/dispositivo e aceita PDF/JPG/PNG até 10 MB. OFX/CSV conhecidos até 2 MB e 500 linhas. HEIC e conversões ainda não implementados.

DRE por caixa não substitui DRE por competência nem balanço patrimonial. Um lote equilibrado não comprova completude da escrituração. Taxas locais são estimativas limitadas a 2026; não reutilizar regras em 2027. O cadastro verifica formatos e exige confirmação do contador; não consulta automaticamente CNAEs/CNPJ, cadastros municipais ou autorização para emissão.

## Verificação

- `npm test`: 21 testes das regras originais e 5 de ida e volta pelo banco (tradução).
- RLS testado no Supabase com escritórios distintos e papéis de cliente (sócio, financeiro, emissor, anônimo).
- Fluxos testados no navegador: cadastro do escritório, carteira, classificação, matriz, convite, aceite pelo cliente, nota simulada e documentos.

## Fontes da implementação

- Marca: anexos contagiro-marca_1.zip e contagiro-guia-identidade_1.html. SVGs do ZIP em curvas são fonte da verdade. Fontes Google Fonts, com licenças OFL em public/fonts.
- Simples / Fator R: https://www8.receita.fazenda.gov.br/simplesnacional/arquivos/manual/perguntaosn.pdf
- LC 123 e tabelas: https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm
- Local de incidência e retenção: https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm
- ISS retido / parcela efetiva: https://normas.receita.fazenda.gov.br/sijut2consulta/anexoOutros.action?idArquivoBinario=54881
- Domínio Separador: https://suporte.dominioatendimento.com/central/faces/solucao.html?codigo=672

Ecossistema próprio. Domínio é somente destino opcional de exportação do serviço contábil adicional; não há integração com Onvio ou gestão externa de tarefas. Comércio e documentos fiscais de mercadorias permanecem fora do escopo.
