"use client";
// Assistente de entrada do cliente (5 etapas, uma tela por etapa). O andamento fica no servidor
// (tabela onboardings), então o cliente pode sair e voltar de onde parou.
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Check, ExternalLink, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { criarClienteNavegador } from "@/lib/supabase/navegador";
import { ETAPAS, PLANOS, SERVICOS_PROCURACAO, type DadosEmpresa, type Plano } from "@/lib/onboarding";

type Estado = {
  usuario: { email: string; nome: string };
  equipe: boolean;
  jaCliente: boolean;
  onboarding: { etapa: number; plano: Plano | null } | null;
  empresa: { razao_social: string; cnpj: string; municipio: string } | null;
  cnpjEscritorio: string | null;
};

const formatarCnpj = (c: string | null) => (c ?? "").replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

async function postar(corpo: Record<string, unknown>) {
  const res = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error);
  return d as { etapa: number; message: string; destino?: string };
}

export default function Assistente() {
  const [logado, setLogado] = useState<boolean | null>(null);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [etapa, setEtapa] = useState(1);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const { data } = await criarClienteNavegador().auth.getUser();
    setLogado(!!data.user);
    if (!data.user) return;
    const res = await fetch("/api/onboarding", { cache: "no-store" });
    const d = await res.json();
    if (!res.ok) { setErro(d.error); return; }
    setEstado(d);
    setEtapa(d.onboarding?.etapa ?? 1);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function avancar(corpo: Record<string, unknown>) {
    setErro(""); setOcupado(true);
    try {
      const r = await postar(corpo);
      if (r.destino) { window.location.assign(r.destino); return; }
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <main className="assistente">
      <header className="lp-topo">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG da marca */}
        <Link href="/"><img src="/brand/contagiro-horizontal-cor.svg" alt="ContaGiro" width="150" height="40" /></Link>
        <nav><Link href="/cliente/entrar">Já tenho acesso</Link></nav>
      </header>

      <ol className="assistente-passos" aria-label="Etapas">
        {ETAPAS.map((e) => (
          <li key={e.numero} className={e.numero < etapa ? "feita" : e.numero === etapa ? "atual" : ""} aria-current={e.numero === etapa ? "step" : undefined}>
            <span>{e.numero < etapa ? <Check size={14} /> : e.numero}</span>{e.titulo}{e.numero === 5 && <small>contador</small>}
          </li>
        ))}
      </ol>

      <section className="assistente-cartao">
        {erro && <div className="acesso-erro" role="alert">{erro}</div>}
        {logado === null ? <p className="muted"><Loader2 className="spin" size={16} /> Carregando…</p>
          : !logado ? <CriarAcesso aoCriar={carregar} />
          : !estado ? <p className="muted"><Loader2 className="spin" size={16} /> Carregando…</p>
          : estado.equipe ? <Aviso titulo="Você é da equipe do escritório" texto="Novos clientes são cadastrados pelo painel do contador." link="/contador" rotulo="Ir para o painel" />
          : estado.jaCliente ? <Aviso titulo="Você já é cliente" texto="Seu acesso veio por convite do escritório." link="/cliente" rotulo="Entrar no aplicativo" />
          : etapa === 1 ? <Empresa usuario={estado.usuario} ocupado={ocupado} aoEnviar={(d) => avancar({ etapa: 1, ...d })} />
          : etapa === 2 ? <Planos atual={estado.onboarding?.plano ?? null} ocupado={ocupado} aoEscolher={(plano) => avancar({ etapa: 2, plano })} />
          : etapa === 3 ? <Pagamento ocupado={ocupado} aoAceitar={() => avancar({ etapa: 3, aceite: true })} />
          : etapa === 4 ? <Procuracao cnpjEscritorio={estado.cnpjEscritorio} empresa={estado.empresa} ocupado={ocupado} aoConfirmar={() => avancar({ etapa: 4, procuracao: true })} />
          : <Aviso titulo="Tudo pronto!" texto="Sua grade tributária está com o contador (etapa 5). Enquanto isso, você já pode conectar o banco, categorizar o extrato e enviar documentos." link="/cliente" rotulo="Entrar no aplicativo" />}
      </section>
    </main>
  );
}

function Aviso({ titulo, texto, link, rotulo }: { titulo: string; texto: string; link: string; rotulo: string }) {
  return <div className="assistente-aviso"><h1>{titulo}</h1><p>{texto}</p><a className="lp-botao" href={link}>{rotulo} <ArrowRight size={18} /></a></div>;
}

/** Etapa 1a: conta de acesso (e-mail e senha). */
function CriarAcesso({ aoCriar }: { aoCriar: () => Promise<void> }) {
  const [modo, setModo] = useState<"criar" | "entrar">("criar");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setErro(""); setAviso(""); setOcupado(true);
    const supabase = criarClienteNavegador();
    try {
      if (modo === "criar") {
        const { data, error } = await supabase.auth.signUp({ email: f.email, password: f.senha, options: { data: { nome: f.nome }, emailRedirectTo: `${location.origin}/comecar` } });
        if (error) throw error;
        if (!data.session) { setAviso("Enviamos um e-mail de confirmação. Confirme e volte para esta página para continuar."); setModo("entrar"); return; }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: f.email, password: f.senha });
        if (error) throw error;
      }
      await aoCriar();
    } catch (e) {
      const m = (e as Error).message;
      setErro(m.includes("Invalid login") ? "E-mail ou senha incorretos." : m.includes("already registered") ? "Este e-mail já tem conta: entre com a sua senha." : m);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form className="assistente-form" onSubmit={enviar}>
      <h1>{modo === "criar" ? "Quem é você?" : "Entre para continuar"}</h1>
      <p className="muted">{modo === "criar" ? "Crie seu acesso. Na próxima tela, informe o CNPJ da empresa." : "Use o e-mail e a senha que você criou."}</p>
      {modo === "criar" && <label>Seu nome<Input name="nome" required autoComplete="name" /></label>}
      <label>E-mail<Input name="email" type="email" required autoComplete="email" /></label>
      <label>Senha (mínimo 8 caracteres)<Input name="senha" type="password" minLength={8} required autoComplete={modo === "criar" ? "new-password" : "current-password"} /></label>
      {erro && <div className="acesso-erro" role="alert">{erro}</div>}
      {aviso && <div className="acesso-ok" role="status">{aviso}</div>}
      <Button type="submit" disabled={ocupado}>{ocupado && <Loader2 className="spin" size={16} />}{modo === "criar" ? "Criar acesso" : "Entrar"}</Button>
      <button type="button" className="acesso-link" onClick={() => setModo(modo === "criar" ? "entrar" : "criar")}>{modo === "criar" ? "Já tenho acesso" : "Criar um acesso novo"}</button>
    </form>
  );
}

/** Etapa 1b: empresa, com preenchimento pelo CNPJ (dados abertos da Receita). */
function Empresa({ usuario, ocupado, aoEnviar }: { usuario: Estado["usuario"]; ocupado: boolean; aoEnviar: (d: Record<string, unknown>) => void }) {
  const [f, setF] = useState<Record<string, string>>({ responsavelNome: usuario.nome ?? "", email: usuario.email ?? "" });
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState("");
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function buscar() {
    setAviso(""); setBuscando(true);
    try {
      const res = await fetch(`/api/cnpj/${(f.cnpj ?? "").replace(/\D/g, "")}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      const e = d as DadosEmpresa;
      setF((x) => ({ ...x, cnpj: e.cnpj, razaoSocial: e.razaoSocial, nomeFantasia: e.nomeFantasia ?? "", cep: e.cep ?? "", logradouro: e.logradouro ?? "", numero: e.numero ?? "", complemento: e.complemento ?? "", bairro: e.bairro ?? "", municipio: e.municipio, uf: e.uf, codigoIbge: e.codigoIbge ?? "", telefone: e.telefone ?? x.telefone ?? "", email: e.email ?? x.email ?? "" }));
      setAviso(`${e.razaoSocial} • ${e.situacao ?? ""}${e.simples ? " • Optante do Simples" : ""}${e.cnaeDescricao ? ` • ${e.cnaeDescricao}` : ""}`);
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setBuscando(false);
    }
  }

  const campo = (k: string, rotulo: string, props: Record<string, unknown> = {}) => <label>{rotulo}<Input value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} {...props} /></label>;
  return (
    <form className="assistente-form" onSubmit={(e) => { e.preventDefault(); aoEnviar(f); }}>
      <h1>Sua empresa</h1>
      <p className="muted">Digite o CNPJ e clique em buscar: preenchemos o resto com os dados da Receita. Confira antes de continuar.</p>
      <div className="assistente-cnpj">
        {campo("cnpj", "CNPJ", { required: true, inputMode: "numeric", placeholder: "00.000.000/0000-00" })}
        <Button type="button" variant="outline" disabled={buscando} onClick={buscar}>{buscando ? <Loader2 className="spin" size={16} /> : <Search size={16} />}Buscar</Button>
      </div>
      {aviso && <p className="acesso-ok">{aviso}</p>}
      <div className="form-grid">
        {campo("razaoSocial", "Razão social", { required: true })}
        {campo("nomeFantasia", "Nome fantasia")}
        {campo("cep", "CEP", { inputMode: "numeric" })}
        {campo("logradouro", "Logradouro")}
        {campo("numero", "Número")}
        {campo("complemento", "Complemento")}
        {campo("bairro", "Bairro")}
        {campo("municipio", "Município / UF", { required: true, placeholder: "Salvador / BA" })}
        {campo("uf", "UF", { required: true, maxLength: 2 })}
        {campo("telefone", "Telefone")}
        {campo("email", "E-mail da empresa", { type: "email" })}
        {campo("responsavelNome", "Responsável", { required: true })}
      </div>
      <Button type="submit" disabled={ocupado}>{ocupado && <Loader2 className="spin" size={16} />}Continuar</Button>
    </form>
  );
}

/** Etapa 2: plano. */
function Planos({ atual, ocupado, aoEscolher }: { atual: Plano | null; ocupado: boolean; aoEscolher: (p: Plano) => void }) {
  const [inicial, setInicial] = useState<Plano | null>(atual);
  useEffect(() => { const p = new URLSearchParams(location.search).get("plano"); if (!atual && p && p in PLANOS) setInicial(p as Plano); }, [atual]);
  return (
    <div className="assistente-form">
      <h1>Qual plano você deseja?</h1>
      <div className="lp-planos compacto">
        {(Object.keys(PLANOS) as Plano[]).map((id) => (
          <article key={id} className={`lp-plano ${inicial === id ? "destaque" : ""}`}>
            <h3>{PLANOS[id].nome}</h3>
            <p>{PLANOS[id].resumo}</p>
            <strong className="lp-preco">{PLANOS[id].preco}</strong>
            <ul>{PLANOS[id].itens.map((i) => <li key={i}><Check size={14} />{i}</li>)}</ul>
            <Button disabled={ocupado} variant={inicial === id ? "default" : "outline"} onClick={() => aoEscolher(id)}>Escolher {PLANOS[id].nome}</Button>
          </article>
        ))}
      </div>
    </div>
  );
}

/** Etapa 3: pagamento e contrato — em espera; só o aceite dos termos. */
function Pagamento({ ocupado, aoAceitar }: { ocupado: boolean; aoAceitar: () => void }) {
  const [aceite, setAceite] = useState(false);
  return (
    <div className="assistente-form">
      <h1>Pagamento e contrato</h1>
      <p className="assistente-espera">Em breve: cadastro do meio de pagamento e assinatura digital do contrato. Nesta fase de testes, seguimos só com o aceite dos termos.</p>
      <label className="check-option"><input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />Li e aceito os termos de uso e a política de privacidade do ContaGiro (versão de homologação), inclusive o tratamento dos dados da empresa para a prestação dos serviços contábeis.</label>
      <Button disabled={!aceite || ocupado} onClick={aoAceitar}>{ocupado && <Loader2 className="spin" size={16} />}Continuar</Button>
    </div>
  );
}

/** Etapa 4: procuração no e-CAC para o escritório (Integra Contador). */
function Procuracao({ cnpjEscritorio, empresa, ocupado, aoConfirmar }: { cnpjEscritorio: string | null; empresa: Estado["empresa"]; ocupado: boolean; aoConfirmar: () => void }) {
  const [feito, setFeito] = useState(false);
  return (
    <div className="assistente-form">
      <h1>Procurações</h1>
      <p className="muted">Para o escritório consultar e declarar o Simples Nacional de {empresa?.razao_social ?? "sua empresa"} direto com a Receita, autorize-o no e-CAC.</p>
      <ol className="assistente-lista">
        <li>Acesse o e-CAC com o gov.br ou o certificado digital da empresa.</li>
        <li>Vá em <strong>Senhas e Procurações → Cadastro, Consulta e Cancelamento → Procuração para e-CAC</strong>.</li>
        <li>Outorgado: <strong>{cnpjEscritorio ? `CNPJ ${formatarCnpj(cnpjEscritorio)}` : "CNPJ do escritório (peça ao contador)"}</strong>.</li>
        <li>Marque os serviços: {SERVICOS_PROCURACAO.map((s) => `${s.codigo} (${s.nome})`).join(", ")}.</li>
        <li>Escolha a validade (recomendado: 5 anos) e confirme.</li>
      </ol>
      <a className="lp-link" href="https://cav.receita.fazenda.gov.br/autenticacao/login" target="_blank" rel="noopener noreferrer">Abrir o e-CAC <ExternalLink size={14} /></a>
      <label className="check-option"><input type="checkbox" checked={feito} onChange={(e) => setFeito(e.target.checked)} />Já outorguei a procuração ao escritório.</label>
      <p className="muted">O contador confere a procuração (sem custo) e depois configura sua grade tributária (etapa 5).</p>
      <Button disabled={!feito || ocupado} onClick={aoConfirmar}>{ocupado && <Loader2 className="spin" size={16} />}Concluir e entrar no aplicativo</Button>
    </div>
  );
}
