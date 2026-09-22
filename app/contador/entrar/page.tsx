import { CartaoAcesso } from "@/app/acesso/entrar-form";
import EntrarEquipe from "./entrar-equipe";

export const metadata = { title: "Escritório | ContaGiro", robots: { index: false, follow: false } };

// Acesso da equipe do escritório. Endereço separado, sem link no site público e fora dos
// buscadores (robots noindex). Exige senha + código do aplicativo autenticador.
export default function EntrarContador() {
  return (
    <CartaoAcesso titulo="Acesso do escritório" descricao="Área restrita à equipe.">
      <EntrarEquipe />
    </CartaoAcesso>
  );
}
