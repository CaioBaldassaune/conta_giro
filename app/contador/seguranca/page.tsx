import { CartaoAcesso } from "@/app/acesso/entrar-form";
import CadastrarFator from "./cadastrar-fator";

export const metadata = { title: "Verificação em duas etapas | ContaGiro", robots: { index: false, follow: false } };

// Obrigatório para a equipe: o escritório guarda certificados e dados de todos os clientes.
export default function Seguranca() {
  return (
    <CartaoAcesso titulo="Proteja seu acesso" descricao="A equipe do escritório entra com senha e com um código do celular.">
      <CadastrarFator />
    </CartaoAcesso>
  );
}
