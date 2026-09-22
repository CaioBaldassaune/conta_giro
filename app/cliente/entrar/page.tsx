import Link from "next/link";
import { CartaoAcesso, FormularioAcesso } from "@/app/acesso/entrar-form";

export const metadata = { title: "Entrar | ContaGiro" };

// Entrada do cliente. Sessão própria do cliente (separada da do escritório).
export default function EntrarCliente() {
  return (
    <CartaoAcesso titulo="Entrar">
      <FormularioAcesso destino="/cliente" />
      <div className="acesso-rodape"><span>Ainda não é cliente?</span><Link href="/comecar">Criar conta</Link></div>
    </CartaoAcesso>
  );
}
