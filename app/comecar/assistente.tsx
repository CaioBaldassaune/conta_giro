"use client";
// Cadastro do cliente, feito por ele mesmo, "uma coisa por tela" (padrão do GOV.UK Design System):
//   Conta → CNPJ → Confirmar dados (vindos da Receita) → Plano → Termos → Procuração → app.
// Rótulos acima dos campos, sem texto de exemplo no lugar do rótulo e só os campos
// indispensáveis (Nielsen Norman Group). O andamento fica no servidor (tabela onboardings):
// quem sair volta de onde parou. A sessão é a do CLIENTE, separada da do escritório.
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { criarClienteNavegador } from "@/lib/supabase/navegador";
import { PLANOS, SERVICOS_PROCURACAO, type DadosEmpresa, type Plano } from "@/lib/onboarding";

type Estado = {
  usuario: { email: string; nome: string };
  equipe: boolean;
  jaCliente: boolean;
  onboarding: { etapa: number; plano: Plano | null } | null;
  empresa: { razao_social: string; cnpj: string; municipio: string } | null;
  cnpjEscritorio: string | null;
};
type Tela = "conta" | "cnpj" | "confirmar" | "manual" | "plano" | "termos" | "procuracao";

const TOTAL = 5;
const ETAPA_DA_TELA: Record<Tela, number> = { conta: 1, cnpj: 1, confirmar: 1, manual: 1, plano: 2, termos: 3, procuracao: 4 };
const NOME_ETAPA = ["Seus dados", "Plano", "Termos", "Procuração", "Impostos"];
const cnpjFormatado = (c: string | null) => (c ?? "").replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const sessao = () => criarClienteNavegador("cliente");

async function enviar(corpo: Record<string, unknown>) {
  const res = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error);
  return d as { etapa: number; destino?: string };
}

export default function Assistente() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [tela, setTela] = useState<Tela | null>(null);
  const [empresa, setEmpresa] = useState<Partial<DadosEmpresa> & Record<string, string | boolean | null | undefined>>({});
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const { data } = await sessao().auth.getUser();
    if (!data.user) { setTela("conta"); return; }
    const res = await fetch("/api/onboarding", { cache: "no-store" });
    const d = await res.json();
    if (!res.ok) { setErro(d.error); return; }
    setEstado(d);
    const etapa = d.onboarding?.etapa ?? 1;
    if (d.jaCliente || etapa >= 5) { window.location.assign("/cliente"); return; }
    setTela(etapa === 1 ? "cnpj" : etapa === 2 ? "plano" : etapa === 3 ? "termos" : "procuracao");
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function acao(fn: () => Promise<void>) {
    setErro(""); setOcupado(true);
    try { await fn(); } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }

  const avancar = (corpo: Record<string, unknown>) => acao(async () => {
    const r = await enviar(corpo);
    if (r.destino) { window.location.assign(r.destino); return; }
    await carregar();
  });

  if (estado?.equipe) {
    return <Moldura etapa={1}><h1>Esta conta é da equipe do escritório</h1><p className="muted">Para se cadastrar como cliente, use outro e-mail.</p><Button variant="outline" onClick={() => sessao().auth.signOut().then(() => location.reload())}>Sair</Button></Moldura>;
  }
  if (!tela) return <Moldura etapa={1}><p className="muted"><Loader2 className="spin" size={16} /> Carregando…</p>{erro && <Erro texto={erro} />}</Moldura>;

  const etapa = ETAPA_DA_TELA[tela];
  return (
    <Moldura etapa={etapa}>
      {tela === "conta" && <Conta aoEntrar={carregar} />}

      {tela === "cnpj" && (
        <form onSubmit={(e) => { e.preventDefault(); const cnpj = String(new FormData(e.currentTarget).get("cnpj") ?? "").replace(/\D/g, ""); void acao(async () => {
          const res = await fetch(`/api/cnpj/${cnpj}`, { cache: "no-store" });
          const d = await res.json();
          if (res.status === 404 || res.status === 502) { setEmpresa({ cnpj }); setTela("manual"); return; }
          if (!res.ok) throw new Error(d.error);
          setEmpresa({ ...d, responsavelNome: estado?.usuario.nome ?? "" });
          setTela("confirmar");
        }); }}>
          <h1>Qual é o CNPJ da sua empresa?</h1>
          <p className="muted">Buscamos os dados na Receita Federal para você não precisar digitar.</p>
          <Campo rotulo="CNPJ"><Input name="cnpj" inputMode="numeric" autoComplete="off" required defaultValue={empresa.cnpj ? cnpjFormatado(String(empresa.cnpj)) : ""} /></Campo>
          {erro && <Erro texto={erro} />}
          <Button type="submit" disabled={ocupado}>{ocupado && <Loader2 className="spin" size={16} />}Continuar</Button>
        </form>
      )}

      {tela === "confirmar" && (
        <form onSubmit={(e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); void avancar({ etapa: 1, ...empresa, ...f }); }}>
          <h1>Confira os dados da empresa</h1>
          <dl className="resumo">
            <div><dt>Razão social</dt><dd>{empresa.razaoSocial}</dd></div>
            <div><dt>CNPJ</dt><dd>{cnpjFormatado(String(empresa.cnpj ?? ""))}</dd></div>
            <div><dt>Endereço</dt><dd>{[empresa.logradouro, empresa.numero, empresa.bairro].filter(Boolean).join(", ") || "—"}</dd></div>
            <div><dt>Município</dt><dd>{empresa.municipio || "—"}</dd></div>
            {empresa.situacao && <div><dt>Situação na Receita</dt><dd>{empresa.situacao}{empresa.simples ? " • Simples Nacional" : ""}</dd></div>}
          </dl>
          <Campo rotulo="Seu nome (responsável)"><Input name="responsavelNome" required autoComplete="name" defaultValue={String(empresa.responsavelNome ?? "")} /></Campo>
          <Campo rotulo="Telefone para contato"><Input name="telefone" type="tel" autoComplete="tel" defaultValue={String(empresa.telefone ?? "")} /></Campo>
          {erro && <Erro texto={erro} />}
          <Button type="submit" disabled={ocupado}>{ocupado && <Loader2 className="spin" size={16} />}Está certo, continuar</Button>
          <button type="button" className="link-discreto" onClick={() => setTela("manual")}>Algum dado errado? Corrigir</button>
        </form>
      )}

      {tela === "manual" && (
        <form onSubmit={(e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); const [, uf] = String(f.municipio ?? "").split("/").map((x) => x.trim()); void avancar({ etapa: 1, ...empresa, ...f, uf: String(f.uf || uf || "").toUpperCase() }); }}>
          <h1>Dados da empresa</h1>
          <p className="muted">Não encontramos tudo na Receita. Preencha só o que falta.</p>
          <Campo rotulo="CNPJ"><Input name="cnpj" inputMode="numeric" required defaultValue={cnpjFormatado(String(empresa.cnpj ?? ""))} /></Campo>
          <Campo rotulo="Razão social"><Input name="razaoSocial" required defaultValue={String(empresa.razaoSocial ?? "")} /></Campo>
          <div className="duas-colunas">
            <Campo rotulo="CEP"><Input name="cep" inputMode="numeric" autoComplete="postal-code" defaultValue={String(empresa.cep ?? "")} /></Campo>
            <Campo rotulo="Número"><Input name="numero" defaultValue={String(empresa.numero ?? "")} /></Campo>
          </div>
          <Campo rotulo="Endereço"><Input name="logradouro" autoComplete="address-line1" defaultValue={String(empresa.logradouro ?? "")} /></Campo>
          <Campo rotulo="Bairro"><Input name="bairro" defaultValue={String(empresa.bairro ?? "")} /></Campo>
          <div className="duas-colunas">
            <Campo rotulo="Cidade / UF" dica="Ex.: Salvador / BA"><Input name="municipio" required defaultValue={String(empresa.municipio ?? "")} /></Campo>
            <Campo rotulo="UF"><Input name="uf" maxLength={2} required defaultValue={String(empresa.uf ?? "")} /></Campo>
          </div>
          <Campo rotulo="Seu nome (responsável)"><Input name="responsavelNome" required autoComplete="name" defaultValue={String(empresa.responsavelNome ?? estado?.usuario.nome ?? "")} /></Campo>
          <Campo rotulo="Telefone para contato"><Input name="telefone" type="tel" autoComplete="tel" defaultValue={String(empresa.telefone ?? "")} /></Campo>
          {erro && <Erro texto={erro} />}
          <Button type="submit" disabled={ocupado}>{ocupado && <Loader2 className="spin" size={16} />}Continuar</Button>
        </form>
      )}

      {tela === "plano" && <EscolherPlano atual={estado?.onboarding?.plano ?? null} ocupado={ocupado} erro={erro} aoEscolher={(plano) => avancar({ etapa: 2, plano })} />}

      {tela === "termos" && (
        <form onSubmit={(e) => { e.preventDefault(); void avancar({ etapa: 3, aceite: new FormData(e.currentTarget).get("aceite") === "on" }); }}>
          <h1>Termos de uso</h1>
          <p className="muted">Usamos os dados da empresa só para prestar os serviços contábeis, com acesso restrito e registro de tudo o que é feito. O pagamento e o contrato serão combinados com o escritório nesta fase.</p>
          <label className="marcar"><input type="checkbox" name="aceite" required /><span>Li e aceito os termos de uso e a política de privacidade.</span></label>
          {erro && <Erro texto={erro} />}
          <Button type="submit" disabled={ocupado}>{ocupado && <Loader2 className="spin" size={16} />}Aceitar e continuar</Button>
        </form>
      )}

      {tela === "procuracao" && <Procuracao cnpj={estado?.cnpjEscritorio ?? null} ocupado={ocupado} erro={erro} aoConcluir={() => avancar({ etapa: 4, procuracao: true })} />}
    </Moldura>
  );
}

function Moldura({ etapa, children }: { etapa: number; children: ReactNode }) {
  return (
    <main className="cadastro">
      <header className="cadastro-topo">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG da marca */}
        <Link href="/" aria-label="Página inicial"><img src="/brand/contagiro-horizontal-cor.svg" alt="ContaGiro" width="128" height="34" /></Link>
        <span className="muted">Etapa {etapa} de {TOTAL} • {NOME_ETAPA[etapa - 1]}</span>
      </header>
      <div className="cadastro-progresso" role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL} aria-valuenow={etapa} aria-label="Progresso do cadastro"><span style={{ width: `${(etapa / TOTAL) * 100}%` }} /></div>
      <section className="cadastro-cartao">{children}</section>
    </main>
  );
}

function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: ReactNode }) {
  return <label className="campo"><span>{rotulo}</span>{dica && <small>{dica}</small>}{children}</label>;
}

function Erro({ texto }: { texto: string }) {
  return <div className="aviso-erro" role="alert">{texto}</div>;
}

/** Conta de acesso do cliente (e-mail e senha). */
function Conta({ aoEntrar }: { aoEntrar: () => Promise<void> }) {
  const [modo, setModo] = useState<"criar" | "entrar">("criar");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function enviarConta(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setErro(""); setAviso(""); setOcupado(true);
    try {
      if (modo === "criar") {
        const { data, error } = await sessao().auth.signUp({ email: f.email, password: f.senha, options: { data: { nome: f.nome }, emailRedirectTo: `${location.origin}/comecar` } });
        if (error) throw error;
        if (!data.session) { setAviso("Enviamos um link para o seu e-mail. Confirme e volte aqui para continuar."); setModo("entrar"); return; }
      } else {
        const { error } = await sessao().auth.signInWithPassword({ email: f.email, password: f.senha });
        if (error) throw error;
      }
      await aoEntrar();
    } catch (e) {
      const m = (e as Error).message;
      setErro(m.includes("Invalid login") ? "E-mail ou senha incorretos." : /already registered|already been registered/i.test(m) ? "Este e-mail já tem conta. Entre com a sua senha." : /Password should|weak/i.test(m) ? "Escolha uma senha mais forte (mínimo de 8 caracteres, com letras e números)." : m);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={enviarConta}>
      <h1>{modo === "criar" ? "Crie sua conta" : "Entre para continuar"}</h1>
      {modo === "criar" && <Campo rotulo="Seu nome"><Input name="nome" required autoComplete="name" /></Campo>}
      <Campo rotulo="E-mail"><Input name="email" type="email" required autoComplete="email" /></Campo>
      <Campo rotulo="Senha" dica={modo === "criar" ? "Mínimo de 8 caracteres, com letras e números." : undefined}>
        <Input name="senha" type="password" minLength={8} required autoComplete={modo === "criar" ? "new-password" : "current-password"} />
      </Campo>
      {erro && <Erro texto={erro} />}
      {aviso && <div className="aviso-ok" role="status">{aviso}</div>}
      <Button type="submit" disabled={ocupado}>{ocupado && <Loader2 className="spin" size={16} />}{modo === "criar" ? "Criar conta" : "Entrar"}</Button>
      <button type="button" className="link-discreto" onClick={() => { setModo(modo === "criar" ? "entrar" : "criar"); setErro(""); }}>
        {modo === "criar" ? "Já tenho conta" : "Criar uma conta nova"}
      </button>
    </form>
  );
}

function EscolherPlano({ atual, ocupado, erro, aoEscolher }: { atual: Plano | null; ocupado: boolean; erro: string; aoEscolher: (p: Plano) => void }) {
  const [plano, setPlano] = useState<Plano | null>(atual);
  useEffect(() => { const p = new URLSearchParams(location.search).get("plano"); if (!atual && p && p in PLANOS) setPlano(p as Plano); }, [atual]);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (plano) aoEscolher(plano); }}>
      <h1>Qual plano combina com você?</h1>
      <p className="muted">Dá para mudar depois com o seu contador.</p>
      <fieldset className="opcoes">
        <legend className="sr-only">Planos</legend>
        {(Object.keys(PLANOS) as Plano[]).map((id) => (
          <label key={id} className={`opcao ${plano === id ? "marcada" : ""}`}>
            <input type="radio" name="plano" value={id} checked={plano === id} onChange={() => setPlano(id)} />
            <span className="opcao-texto"><strong>{PLANOS[id].nome}</strong><span>{PLANOS[id].resumo}</span></span>
            {plano === id && <Check size={18} />}
          </label>
        ))}
      </fieldset>
      {erro && <Erro texto={erro} />}
      <Button type="submit" disabled={!plano || ocupado}>{ocupado && <Loader2 className="spin" size={16} />}Continuar</Button>
    </form>
  );
}

function Procuracao({ cnpj, ocupado, erro, aoConcluir }: { cnpj: string | null; ocupado: boolean; erro: string; aoConcluir: () => void }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <form onSubmit={(e) => { e.preventDefault(); aoConcluir(); }}>
      <h1>Autorize o escritório na Receita</h1>
      <p className="muted">Assim o seu contador declara o Simples e emite sua guia direto com a Receita, sem precisar da sua senha.</p>
      <ol className="lista-passos">
        <li>Entre no e-CAC com a sua conta gov.br.</li>
        <li>Abra <strong>Senhas e Procurações → Procuração para e-CAC</strong>.</li>
        <li>
          Autorize o CNPJ {cnpj ? <strong>{cnpjFormatado(cnpj)}</strong> : "do escritório"}
          {cnpj && <button type="button" className="copiar" onClick={() => { void navigator.clipboard?.writeText(cnpj); setCopiado(true); }}><Copy size={14} />{copiado ? "Copiado" : "Copiar"}</button>}
          {" "}com os serviços {SERVICOS_PROCURACAO.map((s) => s.codigo).join(", ")}.
        </li>
      </ol>
      <a className="link-externo" href="https://cav.receita.fazenda.gov.br/autenticacao/login" target="_blank" rel="noopener noreferrer">Abrir o e-CAC <ExternalLink size={14} /></a>
      <label className="marcar"><input type="checkbox" required /><span>Já autorizei o escritório.</span></label>
      {erro && <Erro texto={erro} />}
      <Button type="submit" disabled={ocupado}>{ocupado && <Loader2 className="spin" size={16} />}Concluir e entrar no app</Button>
      <p className="muted pequeno">Depois disso, seu contador configura os impostos (etapa 5). Você já pode usar o app.</p>
    </form>
  );
}
