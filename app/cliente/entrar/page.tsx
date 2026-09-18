import { CartaoAcesso, FormularioAcesso } from "@/app/acesso/entrar-form";

export const metadata = { title: "Entrar • Portal do cliente | ContaGiro" };

export default function EntrarCliente() {
  return (
    <CartaoAcesso titulo="Portal do cliente" descricao="Finanças, notas, documentos e fechamento mensal da sua empresa. O primeiro acesso é feito pelo convite enviado pelo seu escritório de contabilidade.">
      <FormularioAcesso destino="/cliente" />
      <div className="acesso-rodape"><a href="/contador/entrar">Sou contador</a></div>
    </CartaoAcesso>
  );
}
