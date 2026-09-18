import { CartaoAcesso, FormularioAcesso } from "@/app/acesso/entrar-form";

export const metadata = { title: "Entrar • Portal do contador | ContaGiro" };

export default function EntrarContador() {
  return (
    <CartaoAcesso titulo="Portal do contador" descricao="Gestão da carteira, fechamentos e documentos dos clientes.">
      <FormularioAcesso destino="/contador" permitirCadastro />
      <div className="acesso-rodape"><a href="/cliente/entrar">Sou cliente</a></div>
    </CartaoAcesso>
  );
}
