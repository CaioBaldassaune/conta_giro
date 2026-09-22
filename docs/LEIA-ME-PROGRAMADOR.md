# ContaGiro — guia para o programador que vai validar o código

Este é o ponto de partida. Em 15 minutos você deve saber **o que o sistema faz, onde está cada
coisa, como rodar e o que conferir**. Os porquês de cada escolha estão em
[DECISOES.md](DECISOES.md); o modelo de segurança em [SEGURANCA.md](SEGURANCA.md); cada
integração externa em [INTEGRACOES.md](INTEGRACOES.md).

## 1. O que é

O ContaGiro é o **ERP do cliente** de um escritório de contabilidade e o **portal do escritório**.
O sistema contábil oficial continua sendo o **Domínio (Thomson Reuters)**: o ContaGiro organiza a
operação do cliente (extrato, notas, documentos, chamados) e alimenta o Domínio. Hoje roda só em
**homologação** (Vercel Preview + Supabase `contagiro-homolog`), com um cliente real piloto
(Wagner, Luís Eduardo Magalhães/BA), o próprio escritório (BI2B, Palmas/TO) e um cliente de
exemplo fictício (Cliente Amostra, Luís Eduardo Magalhães/BA).

Dois portais no mesmo app:

| Portal | Quem usa | O que vê |
| --- | --- | --- |
| `/contador` | Equipe do escritório | Painel da carteira (100+ empresas), chamados, integrações, e qualquer empresa na visão do cliente |
| `/cliente` | Sócio, financeiro, emissor ou consulta da empresa | Só a própria empresa |
| `/` e `/comecar` | Público | Página inicial e entrada de novo cliente em 5 etapas |

## 2. Pilha

- **Next.js 16** (App Router, `proxy.ts` no lugar de middleware), React 19, TypeScript, Tailwind v4.
- **Supabase**: Postgres com RLS, Auth (e-mail e senha), Storage (bucket privado `documentos`) e
  **Vault** (segredos criptografados).
- **Vercel**: deploy de Preview da branch `homologacao`. A branch `main` é produção e **não recebe
  deploy** nesta fase.

## 3. Como rodar

```bash
cp .env.example .env.local   # preencha URL e chave pública do Supabase; a chave secreta só no servidor
npm install
npm run dev                  # http://localhost:3000
npm test                     # 63 testes (regras, tradução, NFS-e, WebISS, PGDAS-D, Open Finance, entrada)
npm run typecheck
```

Variáveis de ambiente:

| Variável | Onde | Para quê |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Navegador e servidor | Login e dados (com RLS) |
| `SUPABASE_SECRET_KEY` | **Só servidor** | Vault e integrações (ver SEGURANCA.md) |
| `ONBOARDING_ESCRITORIO_ID` | Servidor (opcional) | Escritório que recebe os clientes do autocadastro; sem ela, usa o único escritório |

Os testes de XML (NFS-e Nacional e WebISS) validam contra os XSD oficiais com Python + `lxml`
(`scripts/validar-xsd.py`); sem Python, essa parte é pulada.

## 4. Mapa do código

```
proxy.ts                 sessão do Supabase e porta dos portais (cliente não abre /contador)
next.config.ts           cabeçalhos de segurança (CSP, HSTS, X-Frame-Options...)
app/
  page.tsx               página inicial pública (planos, 5 etapas)
  comecar/               assistente de entrada do cliente (etapas 1–4; a 5 é do contador)
  contador/ cliente/     páginas dos portais (verificam o acesso antes de montar o Portal)
  portal.tsx             casca dos portais (menu, empresa, competência, tela atual)
  screens.tsx ...        telas herdadas (ver cabeçalho de cada arquivo)
  painel/                telas do escritório e componentes novos (painel, chamados, integrações,
                         NFS-e, PGDAS-D, Open Finance)
  api/                   rotas do servidor (uma pasta por recurso)
lib/
  domain.ts contagiro.ts reporting.ts importer.ts   regras (puras, testáveis, herdadas)
  traducao.ts repositorio.ts server.ts               ponte regras ↔ banco e sessão
  carteira.ts                                        painel macro do contador
  serpro*.ts pgdas.ts                                Integra Contador (SERPRO), DAS e PGDAS-D
  nfse/                                              NFS-e Nacional (dps, sefin) e WebISS (abrasf, webiss)
  openfinance*.ts                                    extrato Open Finance (TecnoSpeed) D+1
  onboarding.ts                                      planos, etapas e CNPJ (BrasilAPI)
  certificado.ts                                     leitura do A1 (.pfx) com node-forge
supabase/migrations/     todo o banco, em ordem (aplicadas no projeto de homologação)
tests/                   testes com node:test (transpilados por scripts/test-domain.mjs)
docs/                    esta documentação e as especificações baixadas (XSD, WSDL, OpenAPI)
```

**Convenção:** arquivos "puros" (sem rede e sem banco) têm testes; os que falam com serviços
externos importam `server-only` e ficam finos, chamando os puros.

## 5. Como uma ação percorre o sistema

1. A tela chama uma rota em `app/api/...` (mesma origem; `sameOrigin()` barra outras).
2. A rota chama `context(empresaId)` (`lib/server.ts`): identifica o usuário, carrega a empresa com
   o cliente **do usuário** (RLS vale) e descobre o papel pelos vínculos no banco.
3. As regras (`applyAction` / `reduceAction`) validam e devolvem as alterações (`Entry`).
4. `persist()` → `lib/traducao.ts` converte para as tabelas → `public.aplicar_alteracoes` grava tudo
   numa transação, com trava otimista por empresa (`versao`) e registro em `registros_auditoria`.
   Em conflito, `comRetentativa()` recarrega e reaplica.

Exceções que usam a **chave de serviço** (integrações, cofre e autocadastro) estão listadas, com o
motivo e a verificação de papel, em [SEGURANCA.md](SEGURANCA.md).

## 6. Banco de dados (migrações)

| Migração | Conteúdo |
| --- | --- |
| 000100 base_acesso | escritórios, membros, empresas, membros da empresa, convites, funções de papel |
| 000200 operacao_cliente | competências, contatos, notas, contas e movimentações, regras, documentos |
| 000300 escritorio_folha_contabil | tarefas, cobranças, folha, contabilidade |
| 000400 integracoes_dominio_nfse | estruturas de integração (Domínio, NFS-e) |
| 000500 rls_e_storage | todas as políticas de RLS e do bucket `documentos` |
| 000600 gravacao_atomica | `aplicar_alteracoes` e `travar_empresa` |
| 000700 painel_e_chamados | chamados com mensagens, situação fiscal, `painel_carteira()` |
| 000800 integracao_serpro | credenciais SERPRO (Vault) e registro de cada chamada |
| 000900 / 001000 nfse | configuração NFS-e por empresa, cofre, numeração da DPS |
| 001100 procuracoes_serpro | bloqueio de chamadas cobradas sem procuração |
| 001200 declaracao_pgdas | histórico do PGDAS-D e valor devido no painel |
| 20260919 nfse_webiss | emissor por empresa (Nacional ou WebISS) e endereço do tomador |
| 20260921 open_finance | credenciais TecnoSpeed, conexão da conta, protocolos, contraparte |
| 20260921 onboarding | endereço e plano da empresa, andamento da entrada (5 etapas) |
| 20260921 seguranca_escritorio | cliente não cria escritório |

Nomes em português, minúsculos, com `_`. Valores em **centavos** (bigint). Competência = `AAAA-MM`.

## 7. O que conferir (roteiro de validação)

1. `npm test` e `npm run typecheck` sem erros.
2. **Acessos:** as sessões são separadas por cookie (`cg-sessao-contador` / `cg-sessao-cliente`):
   logado no escritório, `/comecar` deve abrir como visitante. `/contador` só entra com senha **e**
   código do autenticador (no primeiro acesso, cadastra em `/contador/seguranca`). `?view=painel`
   no portal do cliente não mostra o painel; `/api/carteira`, `/api/chamados`, `/api/serpro/*` e
   `/api/integracoes/*` respondem 403 para cliente. Sem o segundo fator, o próprio banco não
   devolve dados da carteira (teste chamando a API do Supabase com o token de um contador `aal1`).
3. **RLS:** consultar tabelas com a chave pública e o token de um cliente só devolve a empresa dele.
4. **Entrada (/comecar):** criar conta, informar o CNPJ (os dados vêm da Receita), confirmar,
   escolher plano, aceitar termos e informar a procuração → cai em `/cliente`, com os "Primeiros
   passos" (banco, certificado A1 enviado pelo próprio sócio, cadastros). O escritório recebe um
   chamado "configurar a grade tributária".
5. **Open Finance:** na empresa de exemplo, Movimentações → Conectar conta → "Usar conta de
   demonstração"; reabrir no dia seguinte deve trazer o extrato de ontem sozinho (D+1), sem
   duplicar. Contrapartes cadastradas aparecem com o nome; as outras com "Cadastrar".
6. **Competências:** nota só no mês corrente; envio/revisão da apuração só de mês encerrado.
7. **Integrações:** ver o status real de cada uma em [INTEGRACOES.md](INTEGRACOES.md).

## 8. Pendências conhecidas

Ver o fim de [SEGURANCA.md](SEGURANCA.md) e de [INTEGRACOES.md](INTEGRACOES.md). As principais:
contrato e credenciais da TecnoSpeed (Open Finance real), CeC de homologação do WebISS,
procuração da Wagner no e-CAC, pagamento/contrato (etapa 3), cron D+1 em produção e BPO
financeiro (no radar).
