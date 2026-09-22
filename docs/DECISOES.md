# Registro de decisões (o que fizemos e por quê)

Cada item: **decisão**, **por quê** e **onde está no código**. Em ordem aproximada de quando foi
tomada (setembro de 2026).

## Produto e escopo

1. **O Domínio é o centro da apuração e da escrituração; o ContaGiro substitui o ERP do cliente.**
   Por quê: o escritório já trabalha no Domínio; o ganho está em organizar a operação do cliente
   ("tudo em casa") e alimentar o Domínio. Por isso não há Diário/Razão/SPED próprios.
   Onde: exportação no leiaute Domínio (`lib/reporting.ts`).
2. **MVP funcional, sem controle financeiro avançado.** BPO financeiro fica no radar (o acesso do
   contador à visão do cliente já prepara esse serviço).
3. **Só homologação.** Deploy apenas de Preview (branch `homologacao`); `main` não recebe deploy.
   Dados reais só dos clientes piloto (Wagner e BI2B); o resto é fictício (LGPD).

## Arquitetura

4. **Next.js na Vercel + Supabase.** Por quê: login, banco com RLS, arquivos e cofre num serviço
   só; RLS dá isolamento entre empresas no próprio banco (defesa em profundidade).
5. **Tabelas normalizadas em português**, não um JSON genérico. Por quê: consultas do painel de
   100+ empresas, integridade (chaves estrangeiras, checks) e legibilidade para o escritório.
6. **Camada de tradução (`lib/traducao.ts`)** entre as regras herdadas (formato `Entry`) e as
   tabelas. Por quê: reaproveitar as regras já testadas sem reescrevê-las.
7. **Gravação atômica por RPC (`aplicar_alteracoes`) com trava otimista.** Por quê: uma ação mexe
   em várias tabelas; ou grava tudo ou nada, e duas pessoas na mesma empresa não se sobrescrevem.
8. **Ids determinísticos (UUIDv5) para ids antigos** e contas bancárias por nome. Por quê: a mesma
   conta/registro sempre cai na mesma linha, sem duplicar.
9. **Valores em centavos (inteiros).** Por quê: evitar erro de arredondamento em dinheiro.

## Visão do contador (100+ clientes)

10. **Painel da carteira calculado no banco (`painel_carteira()`)** e central única de chamados.
    Por quê: o contador não pode abrir empresa por empresa; uma consulta traz todas (testado com
    103 empresas em ~0,5 s).
11. **Competências por calendário:** nota só no mês corrente; apuração só de mês encerrado
    (Brasília). Por quê: regra de trabalho do escritório; evita apurar mês em andamento.
    Onde: `mesAtual/mesApuracao/exigirMesDeEmissao/exigirMesEncerrado` em `lib/domain.ts`.

## SERPRO Integra Contador

12. **O escritório é o contratante; o cliente dá procuração no e-CAC.** Por quê: modelo previsto
    pelo SERPRO para escritórios; uma credencial atende toda a carteira.
13. **Travas de cobrança.** O SERPRO cobra inclusive respostas 403 (sem procuração) e 200 com aviso
    (DAS sem declaração). Por isso: sem procuração, chamadas cobradas são bloqueadas até uma
    verificação gratuita (Caixa Postal); DAS sem PGDAS-D transmitido não é repetido.
    Onde: `lib/serpro.ts` (ProcuracaoPendente), `app/api/serpro/das/route.ts`.
14. **PGDAS-D transmitido pelo ContaGiro com prévia obrigatória.** Por quê: o serviço permite
    calcular sem transmitir; a transmissão só é aceita com os mesmos valores da prévia, então o
    contador vê o imposto antes. Sem faturamento: receita zero, sem guia.
    Onde: `lib/pgdas.ts`, `app/api/serpro/pgdas/route.ts`, `app/painel/declaracao-pgdas.tsx`.

## NFS-e

15. **Emissor Nacional (Sefin) direto**, com o A1 da empresa. Por quê: sem intermediário pago; o
    leiaute é nacional. Antes de emitir, o app consulta o convênio do município (E0037).
16. **WebISS (ABRASF 2.02) para municípios fora do Emissor Nacional** (ex.: Palmas/TO). Por quê:
    Palmas não aceita o Emissor Nacional; o WebISS atende outras cidades também. O emissor é
    escolhido por empresa. Onde: `lib/nfse/abrasf.ts`, `lib/nfse/webiss.ts`.
17. **XML validado contra os XSD oficiais nos testes.** Por quê: rejeição de schema é o erro mais
    comum; pegar isso antes de enviar.

## Open Finance (extrato D+1)

18. **TecnoSpeed (API de Extratos Open Finance).** Por quê: agrega bancos pelo Open Finance
    regulado; a movimentação traz a contraparte com CPF/CNPJ, o que permite cruzar com os cadastros.
19. **D+1 disparado ao abrir Movimentações**, e não só por cron. Por quê: o cron da Vercel só roda
    em produção; em homologação a busca acontece quando alguém abre a tela (uma vez por dia e por
    sessão) ou pelo botão "Sincronizar agora". O período pedido vai da última data importada até
    ontem, então nada se perde se ninguém abrir o app por uns dias.
20. **Contraparte cruzada com os cadastros na tela (não gravada no lançamento).** Por quê: ao
    cadastrar o fornecedor, todos os lançamentos dele passam a casar na hora, sem reprocessar.
    Sem cadastro, a tela oferece "Cadastrar" já preenchido.
21. **Sugestão de categoria pelo histórico da contraparte.** Por quê: o que o cliente já categorizou
    para aquele CNPJ tende a se repetir; a sugestão só aparece quando o histórico é consistente.
22. **Extrato de exemplo para empresas de demonstração.** Por quê: testar o fluxo inteiro sem
    contrato; o formato é o mesmo da API real.

## Entrada de clientes e acessos

23. **Página inicial com 5 etapas; ao concluir a 4ª o cliente já usa o app; a 5ª é do contador.**
    Pedido do escritório. Pagamento e contrato (etapa 3) ficam em espera: só o aceite dos termos.
24. **Autocadastro grava com a chave de serviço, com todas as validações na rota.** Por quê: antes
    de ter vínculo com a empresa, o RLS (corretamente) não deixa o cliente criá-la. A rota valida
    CNPJ, impede duplicar empresa da carteira e cria o vínculo como sócio.
25a. **Sessões separadas por portal (cookies diferentes).** Por quê: o mesmo navegador precisa poder ter o contador logado e, ao mesmo tempo, alguém se cadastrando como cliente, sem um acesso "vazar" no outro. O proxy decide qual sessão vale e sobrescreve qualquer pista vinda do navegador.
25b. **Segundo fator obrigatório para a equipe, exigido pelo banco.** Por quê: o escritório enxerga certificados e dados de todos os clientes; senha sozinha é pouco. Como o RLS exige `aal2`, a proteção vale mesmo fora do app.
25c. **O site público não mostra o acesso do escritório** e o login do escritório não cria contas. Por quê: reduzir a superfície de ataque e não confundir o cliente.
25d. **O cliente faz os próprios cadastros:** empresa (pelo CNPJ), clientes e fornecedores, conta bancária e o próprio certificado digital. O escritório só cuida da parte fiscal (grade tributária).
25. **Separação de acessos em três camadas:** proxy (cliente não abre `/contador`), servidor (papel
    vem do vínculo no banco, nunca do portal pedido) e RLS. O contador pode abrir a visão do cliente.
26. **Cliente não cria escritório.** A função `criar_escritorio` recusa quem já é cliente e, no MVP,
    aceita um único escritório. Por quê: sem isso, um cliente poderia abrir um painel de contador.
