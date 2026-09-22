"use client";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CartaoAcesso } from "./entrar-form";
import { criarClienteNavegador } from "@/lib/supabase/navegador";

async function enviar(url: string, corpo: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

export async function sair(destino: string) {
  await criarClienteNavegador(destino.startsWith("/contador") ? "contador" : "cliente").auth.signOut();
  window.location.assign(destino);
}

/** Primeiro acesso do contador: cria o escritório (e, opcionalmente, empresas fictícias). */
export function NovoEscritorio() {
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [demonstracao, setDemonstracao] = useState(true);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro(""); setOcupado(true);
    try {
      await enviar("/api/escritorio", { nome, cnpj, demonstracao });
      window.location.reload();
    } catch (e) {
      setErro((e as Error).message);
      setOcupado(false);
    }
  }

  return (
    <CartaoAcesso titulo="Cadastre seu escritório" descricao="Você será o titular. Depois poderá convidar sua equipe e seus clientes.">
      <form onSubmit={criar}>
        <label>Nome do escritório<Input required minLength={2} value={nome} onChange={(e) => setNome(e.target.value)} /></label>
        <label>CNPJ (opcional)<Input inputMode="numeric" value={cnpj} onChange={(e) => setCnpj(e.target.value)} /></label>
        <label className="acesso-check"><input type="checkbox" checked={demonstracao} onChange={(e) => setDemonstracao(e.target.checked)} /> Criar 3 empresas fictícias para explorar o sistema</label>
        {erro && <div className="acesso-erro" role="alert">{erro}</div>}
        <Button type="submit" disabled={ocupado}>{ocupado && <Loader2 className="spin" size={16} />}Criar escritório</Button>
      </form>
      <div className="acesso-rodape"><button type="button" className="acesso-link" onClick={() => sair("/contador/entrar")}>Sair</button></div>
    </CartaoAcesso>
  );
}

/** Escritório sem empresas: cadastra a primeira empresa da carteira. */
export function NovaEmpresa() {
  const [razaoSocial, setRazaoSocial] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro(""); setOcupado(true);
    try {
      await enviar("/api/empresas", { razaoSocial, cnpj, municipio });
      window.location.reload();
    } catch (e) {
      setErro((e as Error).message);
      setOcupado(false);
    }
  }

  return (
    <CartaoAcesso titulo="Cadastre a primeira empresa" descricao="Inclua um cliente na carteira. A matriz tributária será confirmada por você dentro do portal.">
      <form onSubmit={criar}>
        <label>Razão social<Input required minLength={2} value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} /></label>
        <label>CNPJ (opcional)<Input inputMode="numeric" value={cnpj} onChange={(e) => setCnpj(e.target.value)} /></label>
        <label>Município / UF<Input placeholder="Palmas / TO" value={municipio} onChange={(e) => setMunicipio(e.target.value)} /></label>
        {erro && <div className="acesso-erro" role="alert">{erro}</div>}
        <Button type="submit" disabled={ocupado}>{ocupado && <Loader2 className="spin" size={16} />}Incluir empresa</Button>
      </form>
      <div className="acesso-rodape"><button type="button" className="acesso-link" onClick={() => sair("/contador/entrar")}>Sair</button></div>
    </CartaoAcesso>
  );
}

export function SemConvite() {
  return (
    <CartaoAcesso titulo="Acesso pendente" descricao="Sua conta ainda não está vinculada a nenhuma empresa. Peça ao seu escritório de contabilidade o link de convite e abra-o com este mesmo e-mail.">
      <div className="acesso-rodape"><button type="button" className="acesso-link" onClick={() => sair("/cliente/entrar")}>Sair</button></div>
    </CartaoAcesso>
  );
}
