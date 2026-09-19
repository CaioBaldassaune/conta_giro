-- NFS-e pelo WebISS (ABRASF 2.02) para municípios fora do Emissor Nacional (ex.: Palmas/TO).

-- Emissor por empresa: Sefin Nacional (padrão) ou WebISS do município.
alter table public.configuracoes_nfse
  add column provedor text not null default 'nacional' check (provedor in ('nacional', 'webiss')),
  add column webiss_municipio text check (webiss_municipio ~ '^[a-z]{3,40}$'), -- subdomínio: palmasto → palmasto.webiss.com.br
  add constraint configuracoes_nfse_webiss_municipio check (provedor <> 'webiss' or webiss_municipio is not null);

-- Endereço estruturado do tomador (o RPS ABRASF pede logradouro, número, bairro, IBGE, UF e CEP).
alter table public.contatos
  add column cep char(8) check (cep ~ '^\d{8}$'),
  add column logradouro text check (length(logradouro) <= 125),
  add column numero_endereco text check (length(numero_endereco) <= 10),
  add column complemento text check (length(complemento) <= 60),
  add column bairro text check (length(bairro) <= 60),
  add column uf char(2) check (uf ~ '^[A-Z]{2}$');
