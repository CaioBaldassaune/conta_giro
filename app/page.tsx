import Link from "next/link";
import { ArrowRight, Check, FileCheck2, KeyRound, Landmark, ReceiptText, ShieldCheck } from "lucide-react";
import { ETAPAS, PLANOS, type Plano } from "@/lib/onboarding";

// Página inicial pública: apresenta o ContaGiro, as 5 etapas de entrada e os planos.
// "Começar agora" leva ao assistente (/comecar); quem já é cliente ou contador entra direto.
export default function Inicio() {
  return (
    <main className="lp">
      <header className="lp-topo">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG da marca, sem otimização */}
        <img src="/brand/contagiro-horizontal-cor.svg" alt="ContaGiro" width="168" height="44" />
        <nav>
          <Link href="/cliente/entrar">Já sou cliente</Link>
          <Link href="/contador/entrar">Sou contador</Link>
          <Link className="lp-botao pequeno" href="/comecar">Começar agora</Link>
        </nav>
      </header>

      <section className="lp-hero">
        <div>
          <span className="lp-selo">Contabilidade + gestão no mesmo aplicativo</span>
          <h1>Seu negócio no giro certo.</h1>
          <p>O extrato do banco chega sozinho todo dia, você categoriza em minutos, emite suas notas e o contador cuida dos impostos. Tudo num lugar só.</p>
          <div className="lp-acoes">
            <Link className="lp-botao" href="/comecar">Começar agora <ArrowRight size={18} /></Link>
            <a className="lp-link" href="#planos">Ver planos</a>
          </div>
        </div>
        <ul className="lp-destaques">
          <li><Landmark size={20} /><span><strong>Extrato automático</strong> pelo Open Finance, com quem pagou e quem recebeu.</span></li>
          <li><ReceiptText size={20} /><span><strong>Nota fiscal</strong> pelo Emissor Nacional ou pela prefeitura.</span></li>
          <li><FileCheck2 size={20} /><span><strong>Simples Nacional</strong>: declaração e DAS direto com a Receita.</span></li>
          <li><ShieldCheck size={20} /><span><strong>Seus dados protegidos</strong>: acesso separado e segredos criptografados.</span></li>
        </ul>
      </section>

      <section className="lp-secao">
        <h2>Como funciona</h2>
        <p className="lp-sub">Cinco etapas. Ao terminar a quarta, você já entra no aplicativo.</p>
        <ol className="lp-etapas">
          {ETAPAS.map((e) => (
            <li key={e.numero}>
              <span className="lp-numero">{e.numero}</span>
              <strong>{e.titulo}</strong>
              <span>{e.descricao}</span>
              {e.numero === 5 && <em>Feita pelo contador</em>}
              {e.numero === 3 && <em>Em breve</em>}
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-secao" id="planos">
        <h2>Planos</h2>
        <p className="lp-sub">Escolha na etapa 2. Dá para mudar depois com o seu contador.</p>
        <div className="lp-planos">
          {(Object.keys(PLANOS) as Plano[]).map((id) => {
            const p = PLANOS[id];
            return (
              <article key={id} className={`lp-plano ${id === "gestao" ? "destaque" : ""}`}>
                {id === "gestao" && <span className="lp-selo">Mais escolhido</span>}
                <h3>{p.nome}</h3>
                <p>{p.resumo}</p>
                <strong className="lp-preco">{p.preco}</strong>
                <ul>{p.itens.map((i) => <li key={i}><Check size={16} />{i}</li>)}</ul>
                <Link className="lp-botao secundario" href={`/comecar?plano=${id}`}>Quero o {p.nome}</Link>
              </article>
            );
          })}
        </div>
      </section>

      <section className="lp-secao lp-seguranca">
        <KeyRound size={24} />
        <div>
          <h2>Segurança</h2>
          <p>Cada cliente vê só a própria empresa; o painel do escritório é exclusivo da equipe. Certificados, tokens e senhas de integração ficam criptografados no cofre do banco de dados e nunca aparecem na tela. Toda alteração fica registrada.</p>
        </div>
      </section>

      <footer className="lp-rodape">
        <span>ContaGiro • ambiente de homologação</span>
        <span><Link href="/cliente/entrar">Portal do cliente</Link> • <Link href="/contador/entrar">Portal do contador</Link></span>
      </footer>
    </main>
  );
}
