-- Regra E0712 do Sistema Nacional NFS-e: para ME/EPP optante do Simples Nacional a DPS
-- deve informar o percentual aproximado dos tributos do SN (pTotTribSN); não é permitido
-- usar indTotTrib = 0. O contador informa o percentual vigente da empresa.
alter table public.configuracoes_nfse
  add column percentual_tributos_sn numeric(4, 2) check (percentual_tributos_sn >= 0 and percentual_tributos_sn < 100);
