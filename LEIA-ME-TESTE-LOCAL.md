# ContaGiro — código-fonte e teste local

Este pacote contém o código da versão 2 publicada, incluindo interface, API, regras de negócio, estrutura do banco, testes, marca e fontes. Foi acrescentado um inicializador exclusivo para demonstração local. Os arquivos originais da aplicação não foram alterados.

## 1. Como abrir no seu computador

Requisito: Node.js **22.13 ou superior**, com npm. Preferência: **Node.js 24 LTS**. Instale pelo site oficial https://nodejs.org/ e reabra o terminal depois da instalação. O primeiro `npm ci` precisa de internet para baixar as dependências fixadas no pacote.

1. Extraia o ZIP por completo em uma pasta do computador. Não execute de dentro do ZIP.
2. Abra um terminal nessa pasta, onde estão `package.json` e `LEIA-ME-TESTE-LOCAL.md`.
3. Execute:

```sh
npm ci
node scripts/local-dev.mjs
```

4. Quando aparecer a mensagem de disponibilidade, abra **http://127.0.0.1:5173** no navegador do mesmo computador. Use esse endereço exato.
5. Mantenha o terminal aberto durante o teste. Para encerrar, pressione **Ctrl+C**. Para abrir novamente, basta executar `node scripts/local-dev.mjs`; não precisa reinstalar as dependências.

Os dois comandos são próprios para terminal Windows, macOS ou Linux; não dependem de Bash. No Windows, se o PowerShell impedir a execução de `npm.ps1`, use `npm.cmd ci` ou abra o Prompt de Comando. Sistemas sem suporte ao runtime nativo de Workers precisarão de um ambiente compatível, como WSL2 no Windows. Não houve teste deste pacote em uma máquina Windows ou macOS.

## 2. Acesso, banco e documentos

- **Não há senha para o teste local.** O inicializador fornece uma identidade fixa de contador de demonstração. Ela não é uma conta real e não autentica no site publicado.
- O primeiro acesso cria três empresas fictícias: Aurora Serviços Administrativos, Estúdio Horizonte e Prisma Engenharia. A competência inicial é agosto/2026.
- O banco D1 e os documentos R2 são emulados localmente. O inicializador aplica a migração SQL antes de abrir a aplicação. Não é necessário criar uma conta Cloudflare, banco remoto ou bucket para esse modo.
- Os dados que você cadastrar ficam na pasta `.wrangler/state` deste projeto. Reabrir a aplicação preserva esses dados. Não foram incluídos dados ou documentos do ambiente publicado.
- Para recomeçar, pare o sistema e **renomeie** `.wrangler/state` para uma pasta de backup, como `state-backup-2026-09-08`. Ao iniciar novamente, uma base nova será preparada. Para restaurar, pare o sistema e recoloque a pasta de backup como `state`.
- A opção **Ver como cliente** é uma prévia da interface. Ela não simula uma sessão separada nem substitui um teste real de permissões entre usuários.

O inicializador limita o acesso a `127.0.0.1:5173`, rejeita origens externas e usa uma identidade local fixa. **Não publique esse modo nem o exponha por túnel ou proxy.** Para instalar o sistema em um servidor com usuários reais, será necessário implementar autenticação própria confiável, provisionar o armazenamento e configurar os controles de acesso. A autenticação atual da versão publicada é fornecida pela hospedagem Sites.

## 3. O que testar primeiro

1. **Gestão da carteira:** visão consolidada, tarefas, clientes, agenda e cobranças avulsas/recorrentes.
2. **Matriz tributária:** atividades, códigos da nota, confirmação do contador e solicitação de alteração.
3. **Movimentações:** use `public/modelo-extrato.csv`, selecione agosto/2026 e revise as classificações.
4. **Documentos:** envie um PDF/JPG/PNG de teste, consulte o histórico, arquive e restaure.
5. **DRE gerencial:** acompanhe os lançamentos classificados e confira a exportação. A DRE implementada usa regime de caixa.
6. **Fechamento:** confira os bloqueios por pendências antes de concluir a competência.

Use dados fictícios durante a validação. Um clique em emissão demonstrativa não gera uma nota fiscal oficial.

## 4. O que está implementado e o que depende de integração

O pacote permite avaliar os fluxos internos de gestão da carteira, matriz, contatos, extratos e classificação, documentos e seus eventos, calendário, tarefas, cobranças internas, solicitações e registros de folha, DRE e preparação da exportação contábil.

**Ainda não foram conectados:** emissão oficial de NFS-e, Integra Contador, transmissão de apuração/PGDAS-D, emissão oficial de DAS, consulta fiscal e parcelamentos, pagamentos/Pix/boleto, e-mail/push, Open Finance e transmissão de folha/eSocial. As solicitações de folha e os valores registrados não constituem um motor legal de cálculo de folha.

O exportador TXT para Domínio está no código, mas a importação real e os códigos do plano de contas de destino precisam de homologação. As estimativas tributárias têm recortes específicos de 2026 descritos no `README.md`; não são um motor tributário universal. Este é um sistema para validar o MVP, ainda com etapas necessárias antes de operação fiscal real.

## 5. Organização para quem vai desenvolver

| Pasta/arquivo | Conteúdo |
| --- | --- |
| `app/` | Interface React e rotas da API |
| `lib/domain.ts`, `lib/contagiro.ts` | Regras e ações do sistema |
| `lib/server.ts` | Acesso, isolamento por empresa e persistência |
| `lib/importer.ts` | Importação de OFX/CSV |
| `lib/reporting.ts` | DRE, preparação contábil e exportações |
| `lib/seed.ts` | Dados fictícios do primeiro acesso |
| `db/`, `drizzle/` | Esquema e migrações do banco |
| `public/brand/`, `public/fonts/` | Marca e fontes com licenças |
| `worker/`, `vite.config.ts` | Execução em Workers via Vinext/Vite |
| `app/chatgpt-auth.ts` | Autenticação da versão hospedada |
| `local/`, `scripts/local-dev.mjs` | Complementos exclusivos para teste local |

Stack: TypeScript, React, Vinext/Vite, Tailwind, Cloudflare Workers, D1 e R2. Não é uma aplicação PHP nem um site de HTML estático. Um servidor Node/Next convencional não substitui automaticamente o runtime de Workers usado aqui.

O `package.json` e o `package-lock.json` originais foram preservados. Use `npm ci` para instalar as versões fixadas. Os scripts originais `npm run dev`, `npm run build` e `npm start` foram feitos para o fluxo da hospedagem; **para abrir esta demonstração, use `node scripts/local-dev.mjs`**.

## 6. Verificações e diagnóstico

```sh
# Preparar o banco sem abrir o servidor
node scripts/local-dev.mjs --check

# Testes de domínio do projeto
npm test

# Restrições do acesso demonstrativo local
node --test local/demo-access.test.mjs

# Conferência de tipos
npx tsc --noEmit
```

Na versão publicada passaram 22 testes de domínio/SQLite, conferência de tipos e compilação. Na preparação deste pacote foram verificados os complementos locais e a correspondência com o código publicado; veja `VERIFICACAO-DO-PACOTE.md` para o resultado preciso.

Não houve ensaio completo de navegação local. A tentativa de executar o emulador de banco neste ambiente de preparação foi interrompida pela mensagem `network approval was cancelled before a decision was returned`. Isso não foi contabilizado como execução aprovada do sistema local. O primeiro ensaio integral deverá ocorrer no seu computador.

| Sintoma | Ação |
| --- | --- |
| `node` ou `npm` não reconhecido | Instale Node.js e reabra o terminal. |
| Módulo não encontrado | Execute `npm ci` na pasta com `package.json`. |
| Dependência nativa incompatível | Confirme Node.js e sistema compatíveis; reinstale com `npm ci` no próprio ambiente. Não copie `node_modules` de outra máquina. |
| Porta 5173 ocupada | Encerre o processo que você já iniciou nessa porta e tente novamente. |
| Redirecionamento para login ou erro 403 | Inicie pelo script local e abra exatamente `http://127.0.0.1:5173`, no mesmo computador. |
| Erro ao preparar banco | Execute `node scripts/local-dev.mjs --check` e preserve a mensagem completa para diagnóstico. |
| `NODE_ENV` configurado como `production` | Use um terminal de desenvolvimento sem essa configuração. O modo demonstrativo recusa produção. |

## 7. Origem do código

Base publicada: ContaGiro, versão 2, commit `91225878eb087e1d0b8b2f4d7d5a9ce4405696d3`, de setembro/2026. O arquivo `ORIGEM-DO-CODIGO.json` relaciona os arquivos originais e os complementos do pacote.

O código da aplicação foi exportado integralmente desse commit. Foram acrescentados somente o inicializador local, sua configuração e verificações, este guia e os arquivos de procedência. Não foram incluídos credenciais, dependências instaladas, histórico Git, arquivos enviados por usuários ou cópia do banco publicado.

O arquivo `.openai/hosting.json` original identifica o projeto e seus bindings lógicos. Ele é preservado como parte do código original; **não é uma credencial nem autoriza publicação**. O teste local usa apenas os bindings `DB` e `DOCUMENTS` e identificadores fictícios de emulação.
