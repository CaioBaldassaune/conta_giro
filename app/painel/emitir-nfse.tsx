"use client";
import { useState } from "react";
import { FileCheck2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Botão "Emitir NFS-e" de um rascunho: envia à Sefin Nacional e atualiza a tela. */
export default function EmitirNfse({ empresaId, notaId, tomador, periodo, desabilitado, onEmitida }: {
  empresaId: string;
  notaId: string;
  tomador: string;
  periodo?: string;
  desabilitado?: boolean;
  onEmitida: () => void;
}) {
  const [emitindo, setEmitindo] = useState(false);

  async function emitir() {
    if (!window.confirm(`Emitir a NFS-e para ${tomador} no Sistema Nacional? O ambiente (teste ou produção) segue a configuração da empresa em Integrações.`)) return;
    setEmitindo(true);
    try {
      const res = await fetch("/api/nfse/emitir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ empresaId, notaId, period: periodo }) });
      const dados = await res.json();
      if (!res.ok) throw new Error(dados.error);
      toast.success(dados.message, { duration: 12000 });
      onEmitida();
    } catch (e) {
      toast.error((e as Error).message, { duration: 20000 });
    } finally {
      setEmitindo(false);
    }
  }

  return (
    <Button size="sm" disabled={desabilitado || emitindo} onClick={emitir}>
      {emitindo ? <Loader2 className="spin" size={14} /> : <FileCheck2 size={14} />}Emitir NFS-e
    </Button>
  );
}
