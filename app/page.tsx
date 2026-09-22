import Link from "next/link";
import { ArrowRight, Check, FileText, Landmark, ShieldCheck } from "lucide-react";
import { PLANOS, type Plano } from "@/lib/onboarding";

// Página inicial pública, só para clientes (o acesso do escritório é separado e não aparece aqui).
// Princípios: uma ação principal (criar conta), pouco texto, muito respiro, leitura no celular.
export default function Inicio() {
  return (
    <main className="site">
      <header className="site-topo">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG da marca, sem otimização */}
        <img src="/brand/contagiro-horizontal-cor.svg" alt="ContaGiro" width="140" height="37" />
        <nav>
          <Link href="/cliente/entrar">Entrar</Link>
          <Link className="site-botao pequeno" href="/comecar">Começar</Link>
        </nav>
      </header>

      <section className="site-hero">
        <h1>Sua contabilidade no giro certo.</h1>
        <p>Extrato do banco automático, notas fiscais e impostos em dia, com um contador de verdade do seu lado.</p>
        <Link className="site-botao" href="/comecar">Criar minha conta <ArrowRight size={18} /></Link>
        <small>Leva poucos minutos. Você só precisa do CNPJ.</small>
      </section>

      <section className="site-secao site-beneficios" aria-label="O que você ganha">
        <div><Landmark size={22} /><h2>Extrato automático</h2><p>Todo dia o banco manda o extrato. Você só categoriza.</p></div>
        <div><FileText size={22} /><h2>Notas fiscais</h2><p>Emita pelo app, sem entrar no site da prefeitura.</p></div>
        <div><ShieldCheck size={22} /><h2>Impostos em dia</h2><p>O escritório declara e envia sua guia. Seus dados ficam protegidos.</p></div>
      </section>

      <section className="site-secao">
        <h2 className="site-titulo">Como começar</h2>
        <ol className="site-passos">
          <li><strong>Crie sua conta</strong><span>E informe o CNPJ.</span></li>
          <li><strong>Escolha o plano</strong><span>Essencial, Gestão ou Estratégia.</span></li>
          <li><strong>Aceite os termos</strong><span>Tudo às claras.</span></li>
          <li><strong>Autorize o escritório</strong><span>Na Receita, pelo e-CAC.</span></li>
        </ol>
        <p className="site-nota">Depois, seu contador configura os impostos. Você já pode usar o app.</p>
      </section>

      <section className="site-secao" id="planos">
        <h2 className="site-titulo">Planos</h2>
        <div className="site-planos">
          {(Object.keys(PLANOS) as Plano[]).map((id) => (
            <article key={id}>
              <h3>{PLANOS[id].nome}</h3>
              <p>{PLANOS[id].resumo}</p>
              <ul>{PLANOS[id].itens.slice(0, 4).map((i) => <li key={i}><Check size={16} />{i}</li>)}</ul>
              <Link href={`/comecar?plano=${id}`}>Escolher {PLANOS[id].nome}</Link>
            </article>
          ))}
        </div>
      </section>

      <footer className="site-rodape">
        <span>© ContaGiro</span>
        {/* Acesso da equipe do escritório: discreto, no rodapé (o cliente entra pelo topo). */}
        <Link href="/contador/entrar">Acesso do escritório</Link>
      </footer>
    </main>
  );
}
