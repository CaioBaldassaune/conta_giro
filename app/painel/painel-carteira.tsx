"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, Loader2, MessageSquare, RefreshCw, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dateLabel, monthLabel } from "@/lib/domain";

type Alerta = { tipo: "critico" | "atencao"; texto: string };
type Empresa = {
  empresa_id: string; razao_social: string; cnpj: string | null; competencia_situacao: string | null;
  lancamentos_pendentes: number; receitas_sem_vinculo: number; notas_rascunho: number; documentos_mes: number;
  chamados_abertos: number; chamados_aguardando_escritorio: number; pgdas_transmitida: boolean | null;
  das_pago: boolean | null; das_vencimento: string | null; fiscal_atualizado_em: string | null;
  alertas: Alerta[]; risco: 0 | 1 | 2;
};
type Painel = {
  competencia: string; prazoPgdas: string; empresas: Empresa[];
  totais: { empresas: number; criticas: number; atencao: number; emDia: number; chamadosAguardando: number; fechadas: number };
};

const SITUACAO: Record<string, string> = { aberta: "Em preparação", enviada: "Enviada ao contador", revisada: "Revisada", aprovada: "Aprovada" };
type Filtro = "todas" | "criticas" | "atencao" | "chamados" | "em_dia";

const cnpjFormatado = (c: string | null) => c ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : "CNPJ não informado";

function Indicador({ valor, rotulo, tom, ativo, onClick }: { valor: number; rotulo: string; tom: string; ativo?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`painel-indicador ${tom} ${ativo ? "ativo" : ""}`} onClick={onClick}>
      <strong>{valor}</strong><span>{rotulo}</span>
    </button>
  );
}

/**
 * Visão macro do contador: todas as empresas numa tabela só, ordenadas por risco,
 * com seleção múltipla para abrir chamados em lote.
 */
export default function PainelCarteira({ competencia, onAbrirEmpresa }: { competencia: string; onAbrirEmpresa: (id: string) => void }) {
  const [painel, setPainel] = useState<Painel | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busca, setBusca] = useState("");
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [loteAberto, setLoteAberto] = useState(false);

  const buscar = useCallback(async (): Promise<Painel> => {
    const res = await fetch(`/api/carteira?competencia=${competencia}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  }, [competencia]);

  useEffect(() => {
    let ativo = true;
    buscar()
      .then((dados) => { if (ativo) { setPainel(dados); setErro(""); } })
      .catch((e: Error) => { if (ativo) setErro(e.message); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [buscar]);

  async function carregar() {
    setCarregando(true); setErro("");
    try {
      setPainel(await buscar());
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (painel?.empresas ?? []).filter((e) =>
      (filtro === "todas" || (filtro === "criticas" && e.risco === 2) || (filtro === "atencao" && e.risco === 1)
        || (filtro === "em_dia" && e.risco === 0) || (filtro === "chamados" && e.chamados_aguardando_escritorio > 0))
      && (!termo || e.razao_social.toLowerCase().includes(termo) || (e.cnpj ?? "").includes(termo.replace(/\D/g, "") || "§")));
  }, [painel, filtro, busca]);

  function alternar(id: string) {
    setSelecionadas((atual) => { const s = new Set(atual); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  }
  const todasMarcadas = visiveis.length > 0 && visiveis.every((e) => selecionadas.has(e.empresa_id));

  if (carregando && !painel) return <div className="painel-vazio"><Loader2 className="spin" /> Carregando a carteira…</div>;
  if (erro && !painel) return <div className="error-banner" role="alert">{erro}<Button size="sm" onClick={carregar}>Tentar novamente</Button></div>;
  if (!painel) return null;
  const t = painel.totais;

  return (
    <div className="painel-carteira">
      <div className="painel-indicadores">
        <Indicador valor={t.empresas} rotulo="empresas na carteira" tom="neutro" ativo={filtro === "todas"} onClick={() => setFiltro("todas")} />
        <Indicador valor={t.criticas} rotulo="críticas" tom="critico" ativo={filtro === "criticas"} onClick={() => setFiltro("criticas")} />
        <Indicador valor={t.atencao} rotulo="pedem atenção" tom="atencao" ativo={filtro === "atencao"} onClick={() => setFiltro("atencao")} />
        <Indicador valor={t.chamadosAguardando} rotulo="chamados aguardando o escritório" tom="atencao" ativo={filtro === "chamados"} onClick={() => setFiltro("chamados")} />
        <Indicador valor={t.fechadas} rotulo={`fechadas em ${monthLabel(painel.competencia)}`} tom="positivo" ativo={filtro === "em_dia"} onClick={() => setFiltro("em_dia")} />
      </div>

      <div className="painel-barra">
        <label className="painel-busca"><Search size={16} /><Input placeholder="Buscar por nome ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} /></label>
        <span className="painel-prazo">PGDAS-D / DAS de {monthLabel(painel.competencia)} vencem em <strong>{dateLabel(painel.prazoPgdas)}</strong></span>
        <Button variant="outline" size="sm" onClick={carregar} disabled={carregando}><RefreshCw size={15} className={carregando ? "spin" : ""} />Atualizar</Button>
        <Button size="sm" disabled={!selecionadas.size} onClick={() => setLoteAberto(true)}><Send size={15} />Abrir chamado ({selecionadas.size})</Button>
      </div>

      <div className="painel-tabela-rolagem">
        <table className="painel-tabela">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Selecionar todas" checked={todasMarcadas} onChange={() => setSelecionadas(todasMarcadas ? new Set() : new Set(visiveis.map((e) => e.empresa_id)))} /></th>
              <th>Empresa</th><th>Fechamento</th><th>Apuração / DAS</th><th>Pendências do mês</th><th>Chamados</th><th>Alertas</th><th />
            </tr>
          </thead>
          <tbody>
            {visiveis.map((e) => (
              <tr key={e.empresa_id} className={`risco-${e.risco}`}>
                <td><input type="checkbox" aria-label={`Selecionar ${e.razao_social}`} checked={selecionadas.has(e.empresa_id)} onChange={() => alternar(e.empresa_id)} /></td>
                <td><strong>{e.razao_social}</strong><small>{cnpjFormatado(e.cnpj)}</small></td>
                <td>{e.competencia_situacao ? SITUACAO[e.competencia_situacao] ?? e.competencia_situacao : "Não aberta"}</td>
                <td>
                  {e.pgdas_transmitida == null ? <span className="painel-cinza">Aguardando SERPRO</span>
                    : e.pgdas_transmitida ? <span className="painel-ok">PGDAS-D entregue</span> : <span className="painel-alerta">PGDAS-D pendente</span>}
                  {e.das_pago != null && <small>{e.das_pago ? "DAS pago" : `DAS em aberto${e.das_vencimento ? ` • vence ${dateLabel(e.das_vencimento)}` : ""}`}</small>}
                </td>
                <td>
                  <small>{e.lancamentos_pendentes} lançamento(s) sem classificação</small>
                  <small>{e.receitas_sem_vinculo} receita(s) sem nota • {e.notas_rascunho} nota(s) em rascunho</small>
                  <small>{e.documentos_mes} documento(s) no mês</small>
                </td>
                <td>{e.chamados_abertos ? <span className={e.chamados_aguardando_escritorio ? "painel-alerta" : ""}><MessageSquare size={14} /> {e.chamados_abertos} aberto(s){e.chamados_aguardando_escritorio ? ` • ${e.chamados_aguardando_escritorio} com você` : ""}</span> : <span className="painel-cinza">—</span>}</td>
                <td className="painel-alertas">
                  {e.alertas.length ? e.alertas.map((a) => <span key={a.texto} className={`painel-chip ${a.tipo}`}>{a.tipo === "critico" && <AlertTriangle size={12} />}{a.texto}</span>)
                    : <span className="painel-chip ok"><CheckCircle2 size={12} />Em dia</span>}
                </td>
                <td><Button variant="ghost" size="sm" onClick={() => onAbrirEmpresa(e.empresa_id)}><Building2 size={14} />Abrir</Button></td>
              </tr>
            ))}
            {!visiveis.length && <tr><td colSpan={8} className="painel-vazio">Nenhuma empresa neste filtro.</td></tr>}
          </tbody>
        </table>
      </div>

      <ChamadoEmLote
        aberto={loteAberto}
        empresas={(painel.empresas).filter((e) => selecionadas.has(e.empresa_id))}
        competencia={painel.competencia}
        onFechar={() => setLoteAberto(false)}
        onEnviado={() => { setLoteAberto(false); setSelecionadas(new Set()); void carregar(); }}
      />
    </div>
  );
}

function ChamadoEmLote({ aberto, empresas, competencia, onFechar, onEnviado }: { aberto: boolean; empresas: Empresa[]; competencia: string; onFechar: () => void; onEnviado: () => void }) {
  const [titulo, setTitulo] = useState(`Documentos de ${monthLabel(competencia)}`);
  const [descricao, setDescricao] = useState("Por favor, envie pelo portal os extratos bancários e documentos do mês para concluirmos o fechamento.");
  const [prioridade, setPrioridade] = useState("normal");
  const [prazo, setPrazo] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    setEnviando(true);
    try {
      const res = await fetch("/api/chamados", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresaIds: empresas.map((e) => e.empresa_id), titulo, descricao, prioridade, prazo: prazo || null, competencia }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.message);
      onEnviado();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Abrir chamado para {empresas.length} empresa(s)</DialogTitle></DialogHeader>
        <div className="painel-form">
          <p className="painel-cinza">{empresas.slice(0, 6).map((e) => e.razao_social).join(", ")}{empresas.length > 6 ? ` e mais ${empresas.length - 6}` : ""}</p>
          <label>Assunto<Input value={titulo} onChange={(e) => setTitulo(e.target.value)} /></label>
          <label>O que o cliente precisa fazer<Textarea rows={4} value={descricao} onChange={(e) => setDescricao(e.target.value)} /></label>
          <div className="painel-form-linha">
            <label>Prioridade
              <select value={prioridade} onChange={(e) => setPrioridade(e.target.value)}>
                <option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option>
              </select>
            </label>
            <label>Prazo<Input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} /></label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={enviar} disabled={enviando || !empresas.length}>{enviando && <Loader2 className="spin" size={15} />}Abrir e avisar clientes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
