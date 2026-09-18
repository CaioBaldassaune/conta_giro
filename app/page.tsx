import { CartaoAcesso } from "./acesso/entrar-form";

export default function Inicio() {
  return (
    <CartaoAcesso titulo="Bem-vindo ao ContaGiro" descricao="Escolha como você quer acessar.">
      <nav className="acesso-portais">
        <a href="/cliente"><strong>Sou cliente</strong><span>Finanças, notas, documentos e fechamento da minha empresa.</span></a>
        <a href="/contador"><strong>Sou contador</strong><span>Carteira de clientes, revisões, agenda e exportação para o Domínio.</span></a>
      </nav>
    </CartaoAcesso>
  );
}
