"use client";
import { useEffect, useMemo, useState } from "react";
import { Calculator, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { money, monthLabel, parseMoney } from "@/lib/domain";
import { Info } from "../ui";

type Proposta = {
  cnpj: string; razaoSocial: string; receitas: { idAtividade: number; valor: number }[]; avisos: string[]; bloqueios: string[];
  notas: number; tipoSugerido: 1 | 2; transmitida: boolean | null; idDeclaracao: string | null;
  atividades: Record<string, string>; tributos: Record<string, string>;
};
type Linha = { idAtividade: number; valor: string };
type Previa = { chave: string; valoresDevidos: { codigoTributo: number; valor: number }[]; totalDevido: number };

const centavos = (v: string) => { try { return v.trim() ? parseMoney(v) : 0; } catch { return NaN; } };
const texto = (c: number) => (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

/**
 * Declaração mensal do Simples (PGDAS-D) pelo SERPRO. Com faturamento: prévia (cálculo do
 * SERPRO, sem transmitir) e depois transmissão travada nos mesmos valores. Sem faturamento:
 * transmissão direta com receita zero, que não gera guia.
 */
export default function DeclaracaoPgdas({ empresa, competencia, onFechar, onConcluida }: {
  empresa: { id: string; nome: string }; competencia: string; onFechar: () => void; onConcluida: () => void;
}) {
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [erro, setErro] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [tipo, setTipo] = useState<1 | 2>(1);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [enviando, setEnviando] = useState<"previa" | "transmitir" | null>(null);

  useEffect(() => {
    fetch(`/api/serpro/pgdas?empresa=${empresa.id}&competencia=${competencia}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d as Proposta; })
      .then((d) => { setProposta(d); setTipo(d.tipoSugerido); setLinhas(d.receitas.map((r) => ({ idAtividade: r.idAtividade, valor: texto(r.valor) }))); })
      .catch((e) => setErro((e as Error).message));
  }, [empresa.id, competencia]);

  const receitas = useMemo(() => linhas.map((l) => ({ idAtividade: l.idAtividade, valor: centavos(l.valor) })), [linhas]);
  const invalidas = receitas.some((r) => !Number.isFinite(r.valor) || r.valor <= 0) || new Set(receitas.map((r) => r.idAtividade)).size !== receitas.length;
  const total = invalidas ? 0 : receitas.reduce((s, r) => s + r.valor, 0);
  const chave = JSON.stringify({ receitas, tipo });
  const previaValida = previa?.chave === chave;
  const semFaturamento = linhas.length === 0;
  const bloqueado = !proposta || proposta.bloqueios.length > 0 || invalidas;
  // Qualquer mudança nas receitas exige nova conferência.
  useEffect(() => setConfirmar(false), [chave]);

  function alterar(i: number, campo: keyof Linha, valor: string) {
    setLinhas((ls) => ls.map((l, j) => j === i ? { ...l, [campo]: campo === "idAtividade" ? Number(valor) : valor } : l));
  }

  async function enviar(modo: "previa" | "transmitir") {
    setEnviando(modo);
    try {
      const res = await fetch("/api/serpro/pgdas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresaId: empresa.id, competencia, modo, tipo, receitas, confirmar, valoresParaComparacao: previaValida ? previa!.valoresDevidos : undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      if (modo === "previa") { setPrevia({ chave, valoresDevidos: d.valoresDevidos, totalDevido: d.totalDevido }); toast.success(d.message); }
      else { toast.success(d.message, { duration: 12000 }); onConcluida(); onFechar(); }
      for (const a of d.avisos ?? []) toast.warning(a, { duration: 15000 });
    } catch (e) {
      toast.error((e as Error).message, { duration: 15000 });
    } finally {
      setEnviando(null);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="pgdas-dialogo">
        <DialogHeader><DialogTitle>PGDAS-D de {monthLabel(competencia)} • {empresa.nome}</DialogTitle></DialogHeader>
        {erro && <Info warning>{erro}</Info>}
        {!proposta && !erro && <p className="painel-cinza"><Loader2 className="spin" size={14} /> Carregando as notas da competência…</p>}
        {proposta && <>
          {proposta.bloqueios.map((b) => <Info warning key={b}>{b}</Info>)}
          {proposta.transmitida && <Info>Já existe declaração transmitida nesta competência{proposta.idDeclaracao ? ` (nº ${proposta.idDeclaracao})` : ""}. Uma nova entrega será <strong>retificadora</strong>.</Info>}
          {proposta.avisos.map((a) => <Info key={a}>{a}</Info>)}

          <div className="pgdas-linhas">
            <div className="pgdas-cabecalho"><span>Atividade no PGDAS-D</span><span>Receita (R$)</span><span /></div>
            {linhas.map((l, i) => (
              <div className="pgdas-linha" key={i}>
                <select value={l.idAtividade} onChange={(e) => alterar(i, "idAtividade", e.target.value)} aria-label="Atividade">
                  {Object.entries(proposta.atividades).map(([id, nome]) => <option key={id} value={id}>{id} • {nome}</option>)}
                </select>
                <Input value={l.valor} inputMode="decimal" aria-label="Receita" onChange={(e) => alterar(i, "valor", e.target.value)} />
                <Button variant="ghost" size="icon" aria-label="Remover atividade" onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))}><Trash2 size={15} /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLinhas((ls) => [...ls, { idAtividade: 14, valor: "" }])}><Plus size={15} />Adicionar receita</Button>
          </div>

          <div className="pgdas-resumo">
            <span>Receita bruta do mês: <strong>{invalidas ? "revise os valores" : money(total)}</strong></span>
            <label>Tipo <select value={tipo} onChange={(e) => setTipo(Number(e.target.value) as 1 | 2)}><option value={1}>Original</option><option value={2}>Retificadora</option></select></label>
          </div>

          {semFaturamento
            ? <Info>Sem faturamento: a declaração vai com receita zero e <strong>não gera guia (DAS)</strong>. Uma única chamada ao SERPRO.</Info>
            : previaValida
              ? <div className="pgdas-previa">
                  <strong>Cálculo do SERPRO (prévia, não transmitida)</strong>
                  {previa!.valoresDevidos.map((v) => <span key={v.codigoTributo}>{proposta.tributos[v.codigoTributo] ?? v.codigoTributo}<b>{money(Math.round(v.valor * 100))}</b></span>)}
                  <span className="total">Total devido<b>{money(previa!.totalDevido)}</b></span>
                </div>
              : <Info>Calcule a prévia: o SERPRO devolve os tributos devidos sem transmitir, e a transmissão só é aceita com esses mesmos valores.</Info>}

          {(semFaturamento || previaValida) && (
            <label className="check-option pgdas-confirmar">
              <input type="checkbox" checked={confirmar} onChange={(e) => setConfirmar(e.target.checked)} />
              Conferi as receitas {semFaturamento ? "(sem faturamento no mês)" : "e os valores calculados"} e autorizo a transmissão da declaração à Receita Federal.
            </label>
          )}
        </>}
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>Fechar</Button>
          {proposta && !semFaturamento && (
            <Button variant="outline" disabled={bloqueado || !!enviando} title="Chamada cobrada pelo SERPRO" onClick={() => enviar("previa")}>
              {enviando === "previa" ? <Loader2 className="spin" size={15} /> : <Calculator size={15} />}Calcular prévia
            </Button>
          )}
          {proposta && (
            <Button disabled={bloqueado || !!enviando || !confirmar || (!semFaturamento && !previaValida)} onClick={() => enviar("transmitir")}>
              {enviando === "transmitir" ? <Loader2 className="spin" size={15} /> : <Send size={15} />}{semFaturamento ? "Transmitir sem faturamento" : "Transmitir declaração"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
