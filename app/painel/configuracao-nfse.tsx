"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, FileKey2, Loader2, PlugZap, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Config = {
  ambiente: "producao_restrita" | "producao"; serie_dps: string; proximo_numero_dps: number; codigo_ibge_emissao: string;
  provedor: "nacional" | "webiss"; webiss_municipio: string | null;
  inscricao_municipal: string | null; op_simples_nacional: string; regime_apuracao_sn: string | null; percentual_tributos_sn: number | null; ativa: boolean;
};
type Dados = {
  empresa: { id: string; razao_social: string; cnpj: string | null; municipio: string | null };
  configuracao: Config | null;
  certificado: { cnpj: string; titular: string; valido_ate: string } | null;
  emitidas: { numero: string; chave_acesso: string | null; codigo_verificacao: string | null; ambiente: string; emitida_em: string; tomador_nome: string; valor_servicos: number }[];
  chaveServidorConfigurada: boolean;
};

// Municípios do Padrão Nacional já usados pela carteira (preenchimento rápido do IBGE).
const IBGE_CONHECIDOS: Record<string, string> = { "luis eduardo magalhaes": "2919553", palmas: "1721000" };
// Municípios que emitem pelo WebISS próprio (não aceitam o Emissor Nacional).
const WEBISS_CONHECIDOS: Record<string, string> = { palmas: "palmasto" };
const webissSugerido = (municipio: string | null) => WEBISS_CONHECIDOS[semAcento((municipio ?? "").split("/")[0].trim())] ?? "";
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ibgeSugerido = (municipio: string | null) => IBGE_CONHECIDOS[semAcento((municipio ?? "").split("/")[0].trim())] ?? "";
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Configuração do emissor de NFS-e (Sistema Nacional) por empresa. */
export default function ConfiguracaoNfse({ empresas }: { empresas: { id: string; nome: string }[] }) {
  const [empresaId, setEmpresaId] = useState(empresas[0]?.id ?? "");
  const [dados, setDados] = useState<Dados | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [salvando, setSalvando] = useState(false);
  const [enviandoCert, setEnviandoCert] = useState(false);

  const buscar = useCallback(async (id: string): Promise<Dados> => {
    const res = await fetch(`/api/nfse/configuracao?empresa=${id}`, { cache: "no-store" });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    return d;
  }, []);

  const aplicar = useCallback((d: Dados) => {
    const c = d.configuracao;
    setDados(d);
    setForm({
      ambiente: c?.ambiente ?? "producao_restrita",
      provedor: c?.provedor ?? (webissSugerido(d.empresa.municipio) ? "webiss" : "nacional"),
      webissMunicipio: c?.webiss_municipio ?? webissSugerido(d.empresa.municipio),
      serie: c?.serie_dps ?? "1",
      proximoNumero: String(c?.proximo_numero_dps ?? 1),
      codigoIbge: c?.codigo_ibge_emissao ?? ibgeSugerido(d.empresa.municipio),
      inscricaoMunicipal: c?.inscricao_municipal ?? "",
      opSimples: c?.op_simples_nacional ?? "3",
      regimeApuracaoSN: c?.regime_apuracao_sn ?? "1",
      percentualTributosSN: c?.percentual_tributos_sn != null ? String(c.percentual_tributos_sn) : "",
      ativa: c?.ativa ?? false,
      confirmarProducao: false,
    });
  }, []);

  useEffect(() => {
    if (!empresaId) return;
    let ativo = true;
    buscar(empresaId).then((d) => { if (ativo) aplicar(d); }).catch((e: Error) => toast.error(e.message));
    return () => { ativo = false; };
  }, [empresaId, buscar, aplicar]);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      const res = await fetch("/api/nfse/configuracao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ empresaId, ...form }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(d.message);
      aplicar(await buscar(empresaId));
    } catch (erro) {
      toast.error((erro as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function enviarCertificado(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviandoCert(true);
    const fd = new FormData(e.currentTarget);
    fd.set("empresaId", empresaId);
    try {
      const res = await fetch("/api/nfse/certificado", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(d.message);
      (e.target as HTMLFormElement).reset();
      aplicar(await buscar(empresaId));
    } catch (erro) {
      toast.error((erro as Error).message);
    } finally {
      setEnviandoCert(false);
    }
  }

  const c = dados?.configuracao;
  const webiss = form.provedor === "webiss";
  return (
    <section className="integracao-cartao">
      <header>
        <PlugZap size={22} />
        <div>
          <h2>NFS-e • Sefin Nacional ou WebISS</h2>
          <p>Emissão com o certificado A1 de cada empresa: pelo Sistema Nacional (municípios conveniados) ou pelo WebISS do município (ex.: Palmas/TO). Teste primeiro no ambiente de testes.</p>
        </div>
        {c?.ativa ? <span className="painel-chip ok"><CheckCircle2 size={12} />Ativa • {c.ambiente === "producao" ? "produção" : "produção restrita"}</span> : <span className="painel-chip atencao">Inativa</span>}
      </header>

      <label className="painel-form">Empresa
        <select className="painel-select" value={empresaId} onChange={(e) => { setDados(null); setEmpresaId(e.target.value); }}>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
      </label>

      {!dados ? <div className="painel-vazio"><Loader2 className="spin" /> Carregando…</div> : (
        <>
          <dl className="integracao-dados">
            <div><dt>CNPJ</dt><dd>{dados.empresa.cnpj ?? "não informado"}</dd></div>
            <div><dt>Município</dt><dd>{dados.empresa.municipio ?? "—"}</dd></div>
            <div><dt>Certificado A1</dt><dd>{dados.certificado ? `${dados.certificado.titular} • até ${new Date(dados.certificado.valido_ate).toLocaleDateString("pt-BR")}` : <span className="painel-alerta">não enviado</span>}</dd></div>
          </dl>

          <form className="painel-form" onSubmit={salvar}>
            <div className="painel-form-linha">
              <label>Emissor
                <select className="painel-select" value={String(form.provedor)} onChange={(e) => set("provedor", e.target.value)}>
                  <option value="nacional">Sefin Nacional (Emissor Nacional)</option>
                  <option value="webiss">WebISS do município (ABRASF 2.02)</option>
                </select>
              </label>
              {webiss && <label>Município no WebISS (subdomínio)<Input value={String(form.webissMunicipio)} onChange={(e) => set("webissMunicipio", e.target.value)} placeholder="palmasto" /></label>}
            </div>
            {webiss && <p className="painel-cinza">No ambiente de testes, o WebISS usa a homologação (homologacao.webiss.com.br): informe o código IBGE e a inscrição municipal que vierem no CeC de homologação (o manual indica IBGE 9999999). Endereço completo do tomador e código de tributação municipal na matriz são obrigatórios.</p>}
            <div className="painel-form-linha">
              <label>Ambiente
                <select className="painel-select" value={String(form.ambiente)} onChange={(e) => set("ambiente", e.target.value)}>
                  <option value="producao_restrita">{webiss ? "Homologação do WebISS (testes, sem valor fiscal)" : "Produção restrita (testes, sem valor fiscal)"}</option>
                  <option value="producao">Produção (nota com valor fiscal)</option>
                </select>
              </label>
              <label>Código IBGE do município emissor<Input value={String(form.codigoIbge)} onChange={(e) => set("codigoIbge", e.target.value)} placeholder="2919553" /></label>
            </div>
            <div className="painel-form-linha">
              <label>{webiss ? "Série do RPS" : "Série da DPS"}<Input value={String(form.serie)} onChange={(e) => set("serie", e.target.value)} /></label>
              <label>{webiss ? "Próximo número do RPS" : "Próximo número da DPS"}<Input inputMode="numeric" value={String(form.proximoNumero)} onChange={(e) => set("proximoNumero", e.target.value)} /></label>
            </div>
            <div className="painel-form-linha">
              <label>Inscrição municipal<Input value={String(form.inscricaoMunicipal)} onChange={(e) => set("inscricaoMunicipal", e.target.value)} placeholder={webiss ? "Obrigatória no WebISS" : "Obrigatória se cadastrada no município"} /></label>
              <label>Situação no Simples Nacional
                <select className="painel-select" value={String(form.opSimples)} onChange={(e) => set("opSimples", e.target.value)}>
                  <option value="3">Optante ME/EPP</option><option value="2">MEI</option><option value="1">Não optante</option>
                </select>
              </label>
            </div>
            {form.opSimples === "3" && (
              <div className="painel-form-linha">
                <label>Regime de apuração (SN)
                  <select className="painel-select" value={String(form.regimeApuracaoSN)} onChange={(e) => set("regimeApuracaoSN", e.target.value)}>
                    <option value="1">Tributos federais e ISS pelo Simples</option>
                    <option value="2">Federais pelo Simples; ISS fora (sublimite)</option>
                    <option value="3">Federais e ISS fora do Simples</option>
                  </select>
                </label>
                <label>% aproximado de tributos do Simples<Input value={String(form.percentualTributosSN)} onChange={(e) => set("percentualTributosSN", e.target.value)} placeholder="Ex.: 6,00" /></label>
              </div>
            )}
            <label className="acesso-check"><input type="checkbox" checked={!!form.ativa} onChange={(e) => set("ativa", e.target.checked)} /> Emissão ativa para esta empresa</label>
            {form.ambiente === "producao" && (
              <label className="acesso-check"><input type="checkbox" checked={!!form.confirmarProducao} onChange={(e) => set("confirmarProducao", e.target.checked)} /> Confirmo que os testes em produção restrita foram concluídos</label>
            )}
            <div className="integracao-acoes"><Button type="submit" disabled={salvando}>{salvando ? <Loader2 className="spin" size={15} /> : <Save size={15} />}Salvar configuração</Button></div>
          </form>

          <form className="painel-form" onSubmit={enviarCertificado}>
            <p className="painel-cinza">Certificado A1 (e-CNPJ) da própria empresa — é ele que assina e transmite a DPS. Fica criptografado no cofre.</p>
            <div className="painel-form-linha">
              <label>Arquivo .pfx / .p12<Input name="certificado" type="file" accept=".pfx,.p12" required /></label>
              <label>Senha<Input name="senha" type="password" autoComplete="off" required /></label>
            </div>
            <div className="integracao-acoes">
              <Button type="submit" variant="outline" disabled={enviandoCert || !dados.chaveServidorConfigurada}>{enviandoCert ? <Loader2 className="spin" size={15} /> : <FileKey2 size={15} />}{dados.certificado ? "Substituir certificado" : "Enviar certificado"}</Button>
            </div>
          </form>

          {dados.emitidas.length > 0 && (
            <details className="integracao-historico" open>
              <summary>Notas emitidas</summary>
              <table className="painel-tabela">
                <thead><tr><th>Número</th><th>Tomador</th><th>Valor</th><th>Ambiente</th><th>Chave / código de verificação</th></tr></thead>
                <tbody>{dados.emitidas.map((n) => (
                  <tr key={`${n.numero}-${n.chave_acesso ?? n.codigo_verificacao}`}><td>{n.numero}</td><td>{n.tomador_nome}</td><td>{brl(n.valor_servicos)}</td><td>{n.ambiente === "producao" ? "Produção" : "Testes"}</td><td><small>{n.chave_acesso ?? n.codigo_verificacao}</small></td></tr>
                ))}</tbody>
              </table>
            </details>
          )}
        </>
      )}
    </section>
  );
}
