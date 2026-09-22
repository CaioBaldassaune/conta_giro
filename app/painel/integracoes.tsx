"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, KeyRound, Loader2, PlugZap, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConfiguracaoNfse from "./configuracao-nfse";
import ConfiguracaoOpenFinance from "./configuracao-openfinance";

type Situacao = {
  titular: boolean;
  chaveServidorConfigurada: boolean;
  configuracao: null | { cnpj_contratante: string; titular_certificado: string; certificado_valido_ate: string; ativa: boolean; ultimo_teste_em: string | null; ultimo_teste_ok: boolean | null };
  consumoMes: { cobradas: number; total: number };
  ultimas: { id_sistema: string; id_servico: string; status_http: number | null; bilhetada: boolean; mensagem: string | null; criado_em: string; empresas: { razao_social: string } | null }[];
};

const data = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const cnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

/** Integrações do escritório: SERPRO Integra Contador (e, em seguida, NFS-e Nacional). */
export default function Integracoes({ empresas }: { empresas: { id: string; nome: string }[] }) {
  const [situacao, setSituacao] = useState<Situacao | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [agora] = useState(() => Date.now()); // referência para o aviso de vencimento do certificado

  const buscar = useCallback(async (): Promise<Situacao> => {
    const res = await fetch("/api/integracoes/serpro", { cache: "no-store" });
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.error);
    return dados;
  }, []);

  useEffect(() => {
    let ativo = true;
    buscar().then((s) => { if (ativo) setSituacao(s); }).catch((e: Error) => toast.error(e.message));
    return () => { ativo = false; };
  }, [buscar]);

  async function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    try {
      const res = await fetch("/api/integracoes/serpro", { method: "POST", body: new FormData(e.currentTarget) });
      const dados = await res.json();
      if (!res.ok) throw new Error(dados.error);
      toast.success(dados.message);
      setMostrarFormulario(false);
      setSituacao(await buscar());
    } catch (erro) {
      toast.error((erro as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (!situacao) return <div className="painel-vazio"><Loader2 className="spin" /> Carregando integrações…</div>;
  const cfg = situacao.configuracao;
  const vencendo = cfg && Date.parse(cfg.certificado_valido_ate) - agora < 30 * 86_400_000;

  return (
    <div className="integracoes">
      <section className="integracao-cartao">
        <header>
          <PlugZap size={22} />
          <div>
            <h2>SERPRO • Integra Contador</h2>
            <p>Caixa Postal da Receita, PGDAS-D entregue e emissão do DAS direto no painel da carteira.</p>
          </div>
          {cfg?.ativa ? <span className="painel-chip ok"><CheckCircle2 size={12} />Ativa</span> : <span className="painel-chip atencao">Não configurada</span>}
        </header>

        {!situacao.chaveServidorConfigurada && (
          <div className="info-note warning"><ShieldAlert size={18} /><div>
            O servidor ainda não tem a <strong>chave secreta do Supabase</strong> (<code>SUPABASE_SECRET_KEY</code>). Sem ela não é possível guardar
            as credenciais no cofre. Veja as instruções que o ContaGiro enviou para configurá-la.
          </div></div>
        )}

        {cfg && (
          <dl className="integracao-dados">
            <div><dt>Contratante</dt><dd>{cnpj(cfg.cnpj_contratante)}</dd></div>
            <div><dt>Certificado</dt><dd>{cfg.titular_certificado}</dd></div>
            <div><dt>Válido até</dt><dd className={vencendo ? "painel-alerta" : ""}>{data(cfg.certificado_valido_ate)}{vencendo ? " • renove em breve" : ""}</dd></div>
            <div><dt>Último teste</dt><dd>{cfg.ultimo_teste_em ? `${dataHora(cfg.ultimo_teste_em)} • ${cfg.ultimo_teste_ok ? "ok" : "falhou"}` : "—"}</dd></div>
            <div><dt>Consumo no mês</dt><dd><strong>{situacao.consumoMes.cobradas}</strong> chamada(s) cobrada(s) de {situacao.consumoMes.total}</dd></div>
          </dl>
        )}

        {situacao.titular ? (
          mostrarFormulario || !cfg ? (
            <form className="painel-form" onSubmit={salvar}>
              <p className="painel-cinza">
                Use o <strong>certificado e-CNPJ do escritório</strong> — o mesmo usado na contratação na Loja SERPRO. A Consumer Key e o Consumer Secret
                ficam na Área do Cliente SERPRO. Antes de salvar, o ContaGiro testa a autenticação; tudo é guardado criptografado no cofre.
              </p>
              <label>Certificado A1 (.pfx ou .p12)<Input name="certificado" type="file" accept=".pfx,.p12" required /></label>
              <label>Senha do certificado<Input name="senha" type="password" autoComplete="off" required /></label>
              <div className="painel-form-linha">
                <label>Consumer Key<Input name="consumerKey" autoComplete="off" required /></label>
                <label>Consumer Secret<Input name="consumerSecret" type="password" autoComplete="off" required /></label>
              </div>
              <div className="integracao-acoes">
                {cfg && <Button type="button" variant="outline" onClick={() => setMostrarFormulario(false)}>Cancelar</Button>}
                <Button type="submit" disabled={enviando || !situacao.chaveServidorConfigurada}>{enviando ? <Loader2 className="spin" size={15} /> : <KeyRound size={15} />}Testar e salvar</Button>
              </div>
            </form>
          ) : <div className="integracao-acoes"><Button variant="outline" onClick={() => setMostrarFormulario(true)}><KeyRound size={15} />Trocar certificado ou credenciais</Button></div>
        ) : !cfg && <p className="painel-cinza">Peça ao titular do escritório para configurar a integração.</p>}

        {situacao.ultimas.length > 0 && (
          <details className="integracao-historico">
            <summary>Últimas chamadas ao SERPRO</summary>
            <table className="painel-tabela">
              <thead><tr><th>Quando</th><th>Empresa</th><th>Serviço</th><th>Resultado</th><th>Cobrada</th></tr></thead>
              <tbody>
                {situacao.ultimas.map((u, i) => (
                  <tr key={i}>
                    <td>{dataHora(u.criado_em)}</td>
                    <td>{u.empresas?.razao_social ?? "—"}</td>
                    <td>{u.id_sistema} / {u.id_servico}</td>
                    <td>HTTP {u.status_http ?? "—"}{u.mensagem ? <small>{u.mensagem}</small> : null}</td>
                    <td>{u.bilhetada ? "Sim" : "Não"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </section>

      <ConfiguracaoNfse empresas={empresas} />
      <ConfiguracaoOpenFinance />
    </div>
  );
}
