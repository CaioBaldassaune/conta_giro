# Verificação do pacote ContaGiro v2

Preparado em 08/09/2026. Base publicada: `91225878eb087e1d0b8b2f4d7d5a9ce4405696d3`.

## Verificado nesta exportação

- Todos os 139 arquivos rastreados do commit publicado foram incluídos com o mesmo conteúdo, conferido byte a byte. Os complementos de teste local estão relacionados em `ORIGEM-DO-CODIGO.json`.
- Sintaxe dos scripts locais aprovada por `node --check`.
- Três testes do acesso de demonstração aprovados: identidade fixa; rejeição de acesso/origem externos; restrição do plugin a desenvolvimento local.
- A migração original foi aplicada com sucesso a um banco SQLite em memória, com as cinco tabelas esperadas.
- A configuração Vite foi resolvida com sucesso, sem iniciar servidor: escuta em `127.0.0.1:5173`, porta fixa e middleware local antes do encaminhamento da aplicação ao runtime.
- O lockfile mantém as versões originais e aponta para o registro público npm, sem credenciais embutidas nas URLs.
- O ZIP foi conferido quanto à integridade e à lista exata de arquivos. Não inclui `node_modules`, `.git`, `.env`, banco local, uploads ou saídas de compilação.

## Verificação anterior da base publicada

22 testes de domínio/SQLite, conferência TypeScript e compilação aprovados na preparação da versão 2. Eles não equivalem a homologação fiscal nem a ensaio de todas as jornadas no navegador.

## Limite da verificação local

A execução de `node scripts/local-dev.mjs --check`, que aciona o emulador de D1, foi interrompida pelo ambiente com a mensagem `network approval was cancelled before a decision was returned`. Portanto, **a inicialização completa do emulador e a navegação local não foram aprovadas neste ambiente**. A verificação SQL em memória não substitui esse teste.

Os comandos e a configuração foram preparados para teste no computador do destinatário. Não houve ensaio em Windows/macOS, câmera física, integrações oficiais ou importação no Domínio. O pacote não altera a versão publicada nem os acessos existentes.
