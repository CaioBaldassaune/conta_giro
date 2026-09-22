# Integrações externas

Situação em 21/09/2026. "Testado" = chamada real feita; "pronto" = código completo e testado
localmente, aguardando credencial ou cadastro externo.

| Integração | Situação | Código |
| --- | --- | --- |
| SERPRO Integra Contador (Caixa Postal, PGDAS-D, DAS) | Testado (BI2B); Wagner aguarda procuração no e-CAC | `lib/serpro*.ts`, `app/api/serpro/*` |
| PGDAS-D (declaração) pelo SERPRO | Pronto; primeira transmissão real a cargo do contador | `lib/pgdas.ts`, `app/api/serpro/pgdas` |
| NFS-e Emissor Nacional (Sefin) | Testado até a Sefin (certificado, assinatura e XML aceitos) | `lib/nfse/dps.ts`, `sefin.ts`, `emissao.ts` |
| NFS-e WebISS (Palmas/TO) | Testado: produção autentica o certificado; homologação aguarda CeC | `lib/nfse/abrasf.ts`, `webiss.ts` |
| Open Finance (TecnoSpeed) | Pronto; real depende de contrato/credenciais; demonstração testada | `lib/openfinance*.ts`, `app/api/openfinance/*` |
| CNPJ (BrasilAPI) | Testado | `lib/onboarding.ts`, `app/api/cnpj` |
| CEP (ViaCEP) | Testado | `app/contagiro-dialog.tsx` |
| Domínio (exportação TXT) | Pronto; importação no Domínio a homologar | `lib/reporting.ts` |

## SERPRO Integra Contador

- Autenticação: `POST https://autenticacao.sapi.serpro.gov.br/authenticate` com mTLS (e-CNPJ do
  escritório), `Basic key:secret` e `Role-Type: TERCEIROS` → `access_token` + `jwt_token`.
- Chamadas: `https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/{Apoiar|Consultar|Declarar|Emitir|Monitorar}`.
- **Cobrança:** Apoiar/Monitorar não são cobrados; os demais sim, **inclusive 403** e 200 com aviso.
  Cada chamada fica em `requisicoes_serpro` (coluna `bilhetada`).
- Travas: procuração pendente bloqueia chamadas cobradas; DAS sem declaração não é repetido.

## PGDAS-D (TRANSDECLARACAO11)

Especificação baixada de uma cópia pública das páginas do SERPRO. Fluxo: prévia
(`indicadorTransmissao=false`) → transmissão com `indicadorComparacao=true` e os valores da prévia.
Suporta regime de competência, serviços com ISS no próprio município (atividades 11, 12, 14, 15,
17 e 18) e Fator R com folhas validadas. Fora disso, transmitir pelo Domínio.

## NFS-e

- **Nacional:** DPS v1.01 assinada (RSA-SHA1, C14N, sem prefixo), `POST {sefin}/nfse` com XML
  gzip+base64. Antes, consulta `{adn}/parametrizacao/{ibge}/convenio`.
- **WebISS:** ABRASF 2.02, SOAP 1.1, `GerarNfse` síncrono; RPS assinado em
  `InfDeclaracaoPrestacaoServico`. Homologação em `homologacao.webiss.com.br` exige **CeC**.
  Palmas exige código de tributação municipal (ex.: 1719, 1701) e endereço do tomador.
  Cancelamento em Palmas só pelo portal.
- Esquemas e exemplos: `docs/nfse/`.

## Open Finance (TecnoSpeed)

- Especificação: `docs/openfinance/tecnospeed/api.json` (Swagger 2.0 oficial).
- Bases: `https://staging.pagamentobancario.com.br/api/v1` e `https://api.pagamentobancario.com.br/api/v1`.
- Cabeçalhos: `cnpjsh`, `tokensh` (escritório, token no Vault) e `payercpfcnpj` (empresa).
- Fluxo: `POST /payer` → `POST /account` (`statementActived: true`) → cliente autoriza no banco pelo
  `openfinanceLink` → `POST /statement/openfinance` (1 a cada 6 h por conta) →
  `GET /statement/openfinance/{uniqueId}` (3/min).
- Crédito: contraparte = `participantPayer`; débito: `participantReceiver`.
  `transactionDuplicated` é ignorado. Deduplicação pelo `transactionId`.
- **Pendente:** contrato comercial com a TecnoSpeed para liberar as credenciais.

## Pendências externas

1. Wagner: procuração no e-CAC para o CNPJ 63.172.986/0001-05; certificado A1 para NFS-e.
2. BI2B: CeC de homologação no WebISS (ou primeira nota real em produção).
3. TecnoSpeed: contrato e credenciais (CNPJ + token da Software House).
4. Domínio: homologar a importação do TXT e a API (token/ativação).
