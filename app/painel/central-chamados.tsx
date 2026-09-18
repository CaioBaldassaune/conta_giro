"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Loader2, MessageSquare, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dateLabel } from "@/lib/domain";
import ConversaChamado from "./conversa-chamado";

type Chamado = {
  id: string; empresa_id: string; empresa: string; titulo: string; descricao: string; tipo: string; situacao: string;
  prioridade: string; responsavel: string | null; responsavel_id: string | null; aguardando: "escritorio" | "cliente";
  prazo: string | null; criado_em: string; ultima_interacao_em: string;
};
type Membro = { id: string; nome: string };

const SITUACOES: Record<string, string> = { recebida: "Recebida", em_atendimento: "Em atendimento", aguardando_aceite: "Aguardando aceite", orcamento_aceito: "Orçamento aceito", concluida: "Concluída" };
const PRIORIDADES: Record<string, string> = { urgente: "Urgente", alta: "Alta", normal: "Normal", baixa: "Baixa" };
const FILTROS = [
  { id: "comigo", rotulo: "Aguardando o escritório" },
  { id: "abertos", rotulo: "Todos em aberto" },
  { id: "cliente", rotulo: "Aguardando o cliente" },
  { id: "todos", rotulo: "Inclui concluídos" },
] as const;

const haQuanto = (iso: string) => {
  const horas = Math.round((Date.now() - Date.parse(iso)) / 3_600_000);
  return horas < 1 ? "agora" : horas < 48 ? `há ${horas} h` : `há ${Math.round(horas / 24)} dias`;
};

/** Fila única de chamados de todos os clientes, com conversa e controle do atendimento. */
export default function CentralChamados({ onAbrirEmpresa }: { onAbrirEmpresa: (id: string) => void }) {
  const [chamados, setChamados] = useState<Chamado[] | null>(null);
  const [equipe, setEquipe] = useState<Membro[]>([]);
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["id"]>("comigo");
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const incluirConcluidos = filtro === "todos";
  const buscar = useCallback(async (): Promise<Chamado[]> => {
    const res = await fetch(`/api/chamados?situacao=${incluirConcluidos ? "todos" : "abertos"}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.chamados;
  }, [incluirConcluidos]);

  useEffect(() => {
    let ativo = true;
    buscar().then((c) => { if (ativo) setChamados(c); }).catch((e: Error) => toast.error(e.message));
    return () => { ativo = false; };
  }, [buscar]);

  // A equipe muda pouco: carrega uma vez para o seletor de responsável.
  useEffect(() => {
    let ativo = true;
    fetch("/api/equipe", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (ativo) setEquipe(d.equipe ?? []); }).catch(() => undefined);
    return () => { ativo = false; };
  }, []);

  async function carregar() {
    setCarregando(true);
    try {
      setChamados(await buscar());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (chamados ?? []).filter((c) =>
      (filtro !== "comigo" || c.aguardando === "escritorio") && (filtro !== "cliente" || c.aguardando === "cliente")
      && (!termo || c.empresa.toLowerCase().includes(termo) || c.titulo.toLowerCase().includes(termo)));
  }, [chamados, filtro, busca]);
  // Mantém aberto o chamado selecionado mesmo que, após responder, ele saia do filtro.
  const atual = (chamados ?? []).find((c) => c.id === selecionado) ?? null;

  async function atualizar(dados: Record<string, unknown>) {
    if (!atual) return;
    const res = await fetch(`/api/chamados/${atual.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error);
    toast.success(data.message);
    await carregar();
  }

  return (
    <div className="central-chamados">
      <div className="painel-barra">
        <div className="central-filtros">
          {FILTROS.map((f) => <button key={f.id} type="button" className={filtro === f.id ? "ativo" : ""} onClick={() => setFiltro(f.id)}>{f.rotulo}</button>)}
        </div>
        <label className="painel-busca"><Search size={16} /><Input placeholder="Buscar empresa ou assunto" value={busca} onChange={(e) => setBusca(e.target.value)} /></label>
        <Button variant="outline" size="sm" onClick={carregar} disabled={carregando}><RefreshCw size={15} className={carregando ? "spin" : ""} />Atualizar</Button>
      </div>

      <div className="central-corpo">
        <ul className="central-lista">
          {chamados === null && <li className="painel-vazio"><Loader2 className="spin" /> Carregando chamados…</li>}
          {chamados !== null && !visiveis.length && <li className="painel-vazio">Nenhum chamado neste filtro.</li>}
          {visiveis.map((c) => (
            <li key={c.id}>
              <button type="button" className={`central-item ${c.id === selecionado ? "ativo" : ""}`} onClick={() => setSelecionado(c.id)}>
                <span className="central-item-topo">
                  <span className={`painel-chip ${c.prioridade === "urgente" || c.prioridade === "alta" ? "critico" : "neutro"}`}>{PRIORIDADES[c.prioridade] ?? c.prioridade}</span>
                  <span className={c.aguardando === "escritorio" ? "painel-alerta" : "painel-cinza"}>{c.aguardando === "escritorio" ? "Com o escritório" : "Com o cliente"}</span>
                  <small>{haQuanto(c.ultima_interacao_em)}</small>
                </span>
                <strong>{c.titulo}</strong>
                <small>{c.empresa} • {SITUACOES[c.situacao] ?? c.situacao}{c.responsavel ? ` • ${c.responsavel}` : ""}</small>
              </button>
            </li>
          ))}
        </ul>

        <section className="central-detalhe">
          {!atual ? <div className="painel-vazio"><MessageSquare /> Selecione um chamado para ver a conversa.</div> : (
            <>
              <header>
                <div>
                  <h2>{atual.titulo}</h2>
                  <small>{atual.empresa} • {atual.tipo} • aberto em {dateLabel(atual.criado_em.slice(0, 10))}</small>
                </div>
                <Button variant="ghost" size="sm" onClick={() => onAbrirEmpresa(atual.empresa_id)}><Building2 size={14} />Abrir empresa</Button>
              </header>
              <div className="central-controles">
                <label>Situação
                  <select value={atual.situacao} onChange={(e) => atualizar({ situacao: e.target.value })}>
                    {Object.entries(SITUACOES).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                  </select>
                </label>
                <label>Prioridade
                  <select value={atual.prioridade} onChange={(e) => atualizar({ prioridade: e.target.value })}>
                    {Object.entries(PRIORIDADES).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                  </select>
                </label>
                <label>Responsável
                  <select value={atual.responsavel_id ?? ""} onChange={(e) => atualizar({ responsavelId: e.target.value || null })}>
                    <option value="">Sem responsável</option>
                    {equipe.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </select>
                </label>
                <label>Prazo
                  <Input type="date" value={atual.prazo ?? ""} onChange={(e) => atualizar({ prazo: e.target.value || null })} />
                </label>
              </div>
              <ConversaChamado key={atual.id} chamadoId={atual.id} descricaoInicial={atual.descricao} onEnviada={carregar} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
