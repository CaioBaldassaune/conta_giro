"use client";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Mensagem = { id: string; autor_email: string; autor_nome: string; lado: "escritorio" | "cliente"; corpo: string; criado_em: string };

const horario = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/**
 * Conversa de um chamado. Usada na central do contador e no card de solicitação do
 * cliente; o servidor define o lado (escritório/cliente) pelo portal de origem.
 */
export default function ConversaChamado({ chamadoId, descricaoInicial, podeResponder = true, onEnviada }: {
  chamadoId: string;
  descricaoInicial?: string;
  podeResponder?: boolean;
  onEnviada?: () => void;
}) {
  const [mensagens, setMensagens] = useState<Mensagem[] | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  const buscar = useCallback(async (): Promise<Mensagem[]> => {
    const res = await fetch(`/api/chamados/${chamadoId}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.mensagens;
  }, [chamadoId]);

  useEffect(() => {
    let ativo = true;
    buscar().then((m) => { if (ativo) setMensagens(m); }).catch((e: Error) => toast.error(e.message));
    return () => { ativo = false; };
  }, [buscar]);

  const carregar = async () => setMensagens(await buscar());

  async function enviar() {
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      const res = await fetch(`/api/chamados/${chamadoId}/mensagens`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ corpo: texto }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTexto("");
      await carregar();
      onEnviada?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="conversa">
      <div className="conversa-mensagens">
        {descricaoInicial && <div className="conversa-msg abertura"><p>{descricaoInicial}</p></div>}
        {mensagens === null ? <Loader2 className="spin" size={18} />
          : mensagens.map((m) => (
            <div key={m.id} className={`conversa-msg ${m.lado}`}>
              <span className="conversa-autor">{m.lado === "escritorio" ? "Escritório" : "Cliente"} • {m.autor_nome || m.autor_email} • {horario(m.criado_em)}</span>
              <p>{m.corpo}</p>
            </div>
          ))}
        {mensagens?.length === 0 && !descricaoInicial && <p className="painel-cinza">Nenhuma mensagem ainda.</p>}
      </div>
      {podeResponder && (
        <div className="conversa-resposta">
          <Textarea rows={2} placeholder="Escreva uma mensagem…" value={texto} onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void enviar(); }} />
          <Button size="sm" onClick={enviar} disabled={enviando || !texto.trim()}>{enviando ? <Loader2 className="spin" size={15} /> : <Send size={15} />}Enviar</Button>
        </div>
      )}
    </div>
  );
}
