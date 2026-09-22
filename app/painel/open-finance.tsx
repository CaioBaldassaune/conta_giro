"use client";
// Cartão do Open Finance na tela de Movimentações (cliente e contador).
// - Sem conta: conectar (banco, agência, conta) → link de consentimento para autorizar no banco.
// - Com conta: busca D+1 automática ao abrir a tela (uma vez por sessão e por dia) e botão manual.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Landmark, Link2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dateLabel } from "@/lib/domain";

type Conta = { id: string; nome: string; openfinance_situacao: string; openfinance_link: string | null; openfinance_ultimo_dia: string | null };
type Dados = { contas: Conta[]; pendentes: number; ontem: string; demonstracao: boolean; podeConectar: boolean };

const SITUACAO: Record<string, string> = { aguardando_consentimento: "Aguardando autorização no banco", conectada: "Conectada", revogada: "Autorização revogada", demonstracao: "Demonstração" };

export default function OpenFinance({ empresaId, onAtualizar }: { empresaId: string; onAtualizar: () => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [conectando, setConectando] = useState(false);
  const [formAberto, setFormAberto] = useState(false);
  const automatico = useRef(false);

  const carregar = useCallback(async () => {
    const res = await fetch(`/api/openfinance/contas?empresa=${empresaId}`, { cache: "no-store" });
    const d = await res.json();
    if (res.ok) setDados(d);
    return res.ok ? (d as Dados) : null;
  }, [empresaId]);

  const sincronizar = useCallback(async (silencioso = false) => {
    setSincronizando(true);
    try {
      const res = await fetch("/api/openfinance/sincronizar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ empresaId }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      if (d.importados || !silencioso) toast.success(d.message);
      for (const a of d.avisos ?? []) toast.warning(a, { duration: 12000 });
      if (d.importados) onAtualizar();
      await carregar();
    } catch (e) {
      if (!silencioso) toast.error((e as Error).message);
    } finally {
      setSincronizando(false);
    }
  }, [empresaId, carregar, onAtualizar]);

  // D+1 automático: ao abrir a tela, se alguma conta ainda não tem o extrato de ontem.
  useEffect(() => {
    automatico.current = false;
    void carregar().then((d) => {
      if (!d || automatico.current) return;
      const atrasada = d.contas.some((c) => c.openfinance_situacao !== "revogada" && (!c.openfinance_ultimo_dia || c.openfinance_ultimo_dia < d.ontem));
      const chave = `of:${empresaId}:${d.ontem}`;
      let jaTentou = false;
      try { jaTentou = sessionStorage.getItem(chave) === "1"; sessionStorage.setItem(chave, "1"); } catch { /* sem armazenamento: tenta */ }
      automatico.current = true;
      if (atrasada && !jaTentou) void sincronizar(true);
    });
  }, [empresaId, carregar, sincronizar]);

  async function conectar(e: FormEvent<HTMLFormElement> | null, demonstracao = false) {
    e?.preventDefault();
    const campos = e ? Object.fromEntries(new FormData(e.currentTarget)) : {};
    setConectando(true);
    try {
      const res = await fetch("/api/openfinance/contas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ empresaId, demonstracao, ...campos }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(d.message, { duration: 10000 });
      if (d.link) window.open(d.link, "_blank", "noopener,noreferrer");
      setFormAberto(false);
      await carregar();
      if (demonstracao) await sincronizar();
    } catch (erro) {
      toast.error((erro as Error).message, { duration: 12000 });
    } finally {
      setConectando(false);
    }
  }

  if (!dados) return null;
  return (
    <section className="panel openfinance-cartao">
      <div className="openfinance-topo">
        <span className="icon-soft"><Landmark size={20} /></span>
        <div>
          <strong>Extrato automático (Open Finance)</strong>
          <p className="muted">
            {dados.contas.length
              ? `As movimentações de ontem (${dateLabel(dados.ontem)}) chegam sozinhas. ${dados.pendentes ? `${dados.pendentes} aguardam categorização.` : "Tudo categorizado."}`
              : "Conecte a conta da empresa para receber o extrato todo dia, sem importar arquivos."}
          </p>
        </div>
        <div className="openfinance-acoes">
          {dados.contas.length > 0 && <Button variant="outline" size="sm" disabled={sincronizando} onClick={() => sincronizar()}>{sincronizando ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}Sincronizar agora</Button>}
          {dados.podeConectar && <Button size="sm" variant={dados.contas.length ? "ghost" : "default"} onClick={() => setFormAberto((v) => !v)}><Link2 size={15} />Conectar conta</Button>}
        </div>
      </div>

      {dados.contas.map((c) => (
        <div className="openfinance-conta" key={c.id}>
          <span><strong>{c.nome}</strong> • {SITUACAO[c.openfinance_situacao] ?? c.openfinance_situacao}{c.openfinance_ultimo_dia ? ` • extrato até ${dateLabel(c.openfinance_ultimo_dia)}` : ""}</span>
          {c.openfinance_situacao === "aguardando_consentimento" && c.openfinance_link && <a className="text-button" href={c.openfinance_link} target="_blank" rel="noopener noreferrer">Autorizar no banco</a>}
        </div>
      ))}

      {formAberto && (
        <form className="openfinance-form" onSubmit={(e) => conectar(e)}>
          {dados.demonstracao && <p className="muted">Empresa de demonstração: use a conta de exemplo (sem banco real) ou informe uma conta para testar com a TecnoSpeed.</p>}
          <div className="form-grid">
            <label>Banco (código)<Input name="banco" inputMode="numeric" placeholder="001" required /></label>
            <label>Agência<Input name="agencia" inputMode="numeric" required /></label>
            <label>Dígito da agência<Input name="agenciaDigito" /></label>
            <label>Conta<Input name="conta" inputMode="numeric" required /></label>
            <label>Dígito da conta<Input name="contaDigito" /></label>
          </div>
          <div className="openfinance-acoes">
            <Button type="submit" disabled={conectando}>{conectando ? <Loader2 className="spin" size={15} /> : <Link2 size={15} />}Cadastrar e autorizar no banco</Button>
            {dados.demonstracao && <Button type="button" variant="outline" disabled={conectando} onClick={() => conectar(null, true)}>Usar conta de demonstração</Button>}
          </div>
        </form>
      )}
    </section>
  );
}
