import type { Metadata } from "next";
import Assistente from "./assistente";

export const metadata: Metadata = { title: "Começar | ContaGiro" };

// Entrada de novos clientes (5 etapas). Página pública: a etapa 1 cria o acesso.
export default function Comecar() {
  return <Assistente />;
}
