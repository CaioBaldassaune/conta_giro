# Segurança e criptografia

## Camadas

| Camada | O que faz | Onde |
| --- | --- | --- |
| Transporte | Só HTTPS; HSTS de 2 anos | Vercel + `next.config.ts` |
| Navegador | CSP restritiva, sem iframe (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), `nosniff`, `Referrer-Policy`, `Permissions-Policy`, sem `x-powered-by` | `next.config.ts` |
| Sessões separadas | O escritório e o cliente têm cookies de sessão diferentes (`cg-sessao-contador` e `cg-sessao-cliente`). Uma sessão nunca vale na área da outra, nem no mesmo navegador. O proxy escolhe a sessão pelo caminho (ou pela página que chamou a rota) e grava isso num cabeçalho interno que sobrescreve o do navegador | `lib/supabase/config.ts`, `proxy.ts`, `lib/supabase/servidor.ts` |
| Segundo fator da equipe | Entrar no escritório exige senha **e** código do aplicativo autenticador (TOTP). Quem ainda não tem, cadastra no primeiro acesso. **O banco também exige**: as funções que dão poder de equipe só respondem com sessão `aal2`, então uma senha vazada não lê nada nem chamando a API do Supabase direto | `app/contador/entrar`, `app/contador/seguranca`, migração `mfa_equipe_e_cofre` |
| Portas dos portais | Sem login → tela de entrada; `/contador` só para a equipe, e o site público não tem link para ele | `proxy.ts` |
| Servidor | Toda rota identifica o usuário e deriva o papel dos vínculos no banco (`membros_escritorio` → contador; `membros_empresa` → cliente). Rotas só da equipe checam `acessos().escritorios`. Requisições de outra origem são recusadas (`sameOrigin`) | `lib/server.ts`, `app/api/**` |
| Banco (RLS) | Toda tabela com RLS: cliente vê só a própria empresa; equipe vê as do seu escritório | `supabase/migrations/*rls*`, políticas por tabela |
| Segredos | Certificados A1 (.pfx) e senhas, credenciais SERPRO, token TecnoSpeed: **Supabase Vault** (criptografados); as tabelas guardam só o id do segredo. Nunca voltam para a tela | funções `cofre_*` e `serpro_*_segredo` |
| Arquivos | Bucket privado `documentos`, caminho por escritório/empresa, hash SHA-256 | `lib/arquivos.ts` |
| Auditoria | Cada gravação registra quem, quando e o quê em `registros_auditoria`; **toda leitura de segredo do cofre** fica em `privado.leituras_cofre` | `aplicar_alteracoes`, `privado.ler_segredo` |

Dados em repouso: o Supabase criptografa o disco (AES-256) e os backups; os segredos têm uma
segunda camada (Vault, com chave gerenciada pelo Supabase).

## Onde a chave de serviço é usada (ignora o RLS) e por quê

A `SUPABASE_SECRET_KEY` existe **só no servidor** (`lib/supabase/admin.ts`, com `server-only`). Cada
uso confere o papel do usuário **antes**:

| Rota | Por que precisa | Verificação antes |
| --- | --- | --- |
| `api/integracoes/serpro` | gravar/ler credenciais no Vault | membro do escritório; alterar só titular |
| `api/serpro/atualizar`, `das`, `pgdas`, `procuracao` | ler credenciais e registrar chamadas | equipe do escritório da empresa |
| `api/nfse/certificado`, `api/nfse/emitir` | A1 no Vault; numeração e retorno da emissão | contador (certificado); papéis que emitem (emissão) |
| `api/openfinance/credenciais` | token TecnoSpeed no Vault | titular do escritório |
| `api/openfinance/contas`, `sincronizar` | ler token, gravar conexão e protocolos | contador, sócio ou financeiro da empresa |
| `api/onboarding` | criar a empresa do autocadastro (o cliente ainda não tem vínculo) | usuário logado, não é da equipe (`sou_equipe`), CNPJ válido e ainda não na carteira; uma entrada por usuário |
| `api/nfse/certificado` | certificado A1 no cofre | sócio da empresa ou equipe; o certificado precisa ser do CNPJ da empresa |

Funções `SECURITY DEFINER` chamáveis por usuários logados (apontadas pelo Supabase como aviso,
são intencionais): `aceitar_convite` (valida o token), `reservar_numero_dps` (confere o papel) e
`criar_escritorio` (recusa cliente e, no MVP, segundo escritório).

## Dados pessoais (LGPD)

- Só dados fictícios nos testes; dados reais apenas dos clientes piloto.
- CPF de contraparte aparece mascarado na tela de Movimentações.
- A consulta de CEP no navegador (ViaCEP) envia só o CEP; a de CNPJ (BrasilAPI) é feita pelo
  servidor e exige login.
- A etapa 3 da entrada registra o aceite dos termos de uso e da política de privacidade
  (versão de homologação: o texto definitivo precisa de revisão jurídica).

## Pendências de segurança (antes de produção)

1. **Ativar a proteção contra senhas vazadas** no Supabase Auth (aviso do Supabase).
2. **Confirmação de e-mail obrigatória** no cadastro (o assistente já trata o caso de confirmação).
3. **Trocar a `SUPABASE_SECRET_KEY`** usada na homologação (ela circulou durante a configuração).
4. **Limite de tentativas** (rate limit) nas rotas públicas/autenticação e CAPTCHA no cadastro.
5. **Cron D+1 em produção** com segredo (`CRON_SECRET`) e usuário de serviço próprio.
6. Avaliar criptografia de coluna para CPF/CNPJ de contrapartes (hoje protegidos por RLS e
   criptografia de disco).
7. Revisão do texto dos termos de uso e política de privacidade.
8. **Perda do celular da equipe:** o segundo fator precisa ser removido no banco (`auth.mfa_factors`) para a pessoa cadastrar outro. Defina quem faz isso e como confirma a identidade.
