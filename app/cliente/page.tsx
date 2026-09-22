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
  // Quem começou a entrada pela página inicial e ainda não concluiu as etapas 1 a 4 volta ao assistente.
  const { data: entrada } = await sb.from("onboardings").select("etapa").eq("usuario_id", user.id).maybeSingle();
  if (entrada && entrada.etapa < 5) redirect("/comecar");
  // O contador também abre o portal do cliente (visão do cliente das empresas da carteira).
  if (!a.empresasCliente.size && !a.escritorios.length) return <SemConvite />;
  return <Portal portal="cliente" />;
}
