import { redirect } from "next/navigation";
import { acessos } from "@/lib/server";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { SemConvite } from "@/app/acesso/primeiro-acesso";
import Portal from "@/app/portal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portal do cliente | ContaGiro" };

export default async function PortalCliente() {
  const sb = await criarClienteServidor();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/cliente/entrar");

  const a = await acessos(sb, user.id);
  if (!a.empresasCliente.size) return <SemConvite />;
  return <Portal portal="cliente" />;
}
