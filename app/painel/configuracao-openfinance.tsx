"use client";
// Credenciais do escritório (Software House) na TecnoSpeed para o extrato via Open Finance.
// O token vai direto para o cofre (Vault) no servidor; a tela nunca o exibe de volta.
import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Landmark, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Estado = { titular: boolean; configuracao: { ambiente: string; cnpj_sh: string; ativa: boolean; atualizado_em: string } | null };

export default function ConfiguracaoOpenFinance() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = () => fetch("/api/openfinance/credenciais", { cache: "no-store" }).then(async (r) => { const d = await r.json(); if (r.ok) setEstado(d); });
  useEffect(() => { void carregar(); }, []);

  async function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setSalvando(true);
    try {
      const res = await fetch("/api/openfinance/credenciais", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(d.message);
      form.reset();
      await carregar();
    } catch (erro) {
      toast.error((erro as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const c = estado?.configuracao;
  return (
    <section className="integracao-cartao">
      <header>
        <Landmark size={22} />
        <div>
          <h2>Open Finance • Extrato bancário (TecnoSpeed)</h2>
          <p>Credenciais do escritório (Software House) na API de Extratos da TecnoSpeed. Com elas, cada cliente conecta a conta e recebe o extrato todo dia (D+1) para categorizar.</p>
        </div>
        {c?.ativa ? <span className="painel-chip ok"><CheckCircle2 size={12} />Ativa • {c.ambiente === "producao" ? "produção" : "homologação"}</span> : <span className="painel-chip atencao">Não configurada</span>}
      </header>
      {!estado ? <div className="painel-vazio"><Loader2 className="spin" /> Carregando…</div> : !estado.titular ? <p className="painel-cinza">Somente o titular do escritório altera as credenciais.</p> : (
        <form className="painel-form" onSubmit={salvar}>
          <div className="painel-form-linha">
            <label>Ambiente
              <select className="painel-select" name="ambiente" defaultValue={c?.ambiente ?? "staging"}>
                <option value="staging">Homologação (staging.pagamentobancario.com.br)</option>
                <option value="producao">Produção</option>
              </select>
            </label>
            <label>CNPJ da Software House (escritório)<Input name="cnpjSh" inputMode="numeric" defaultValue={c?.cnpj_sh ?? ""} required /></label>
          </div>
          <label>Token da Software House<Input name="tokenSh" type="password" autoComplete="off" placeholder={c ? "Guardado no cofre • informe para substituir" : "Portal de contas da TecnoSpeed"} required /></label>
          <p className="painel-cinza">Sem contrato ainda? As empresas de demonstração usam o extrato de exemplo, no mesmo formato da API.</p>
          <div className="integracao-acoes"><Button type="submit" disabled={salvando}>{salvando ? <Loader2 className="spin" size={15} /> : <Save size={15} />}Salvar credenciais</Button></div>
        </form>
      )}
    </section>
  );
}
