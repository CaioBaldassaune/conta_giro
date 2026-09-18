import { redirect } from "next/navigation";
import { acessos } from "@/lib/server";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { NovaEmpresa, NovoEscritorio } from "@/app/acesso/primeiro-acesso";
import Portal from "@/app/portal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portal do contador | ContaGiro" };

export default async function PortalContador() {
  const sb = await criarClienteServidor();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/contador/entrar");

  const a = await acessos(sb, user.id);
  if (!a.escritorios.length) return <NovoEscritorio />;
  const { count } = await sb.from("empresas").select("id", { count: "exact", head: true }).in("escritorio_id", a.escritorios);
  if (!count) return <NovaEmpresa />;
  return <Portal portal="contador" />;
}
