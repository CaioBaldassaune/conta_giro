"use client";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { criarClienteNavegador } from "@/lib/supabase/navegador";

export function CartaoAcesso({ titulo, descricao, children }: { titulo: string; descricao?: string; children: ReactNode }) {
  return (
    <main className="acesso">
      <section className="acesso-cartao">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG da marca, sem otimização */}
        <Link className="brand" href="/"><img src="/brand/contagiro-horizontal-cor.svg" alt="ContaGiro" width="168" height="44" /></Link>
        <h1>{titulo}</h1>
        {descricao && <p>{descricao}</p>}
        {children}
      </section>
    </main>
  );
}

type Modo = "entrar" | "cadastrar";

/**
 * Formulário de e-mail e senha. `permitirCadastro` só no portal do contador e no
 * aceite de convite; o cliente não cria conta sem ser convidado.
 */
export function FormularioAcesso({ destino, permitirCadastro, emailFixo, aoEntrar }: {
  destino: string;
  permitirCadastro?: boolean;
  emailFixo?: string;
  aoEntrar?: () => Promise<void>;
}) {
  const [modo, setModo] = useState<Modo>("entrar");
  const [email, setEmail] = useState(emailFixo ?? "");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(""); setAviso(""); setOcupado(true);
    const supabase = criarClienteNavegador();
    try {
      if (modo === "cadastrar") {
        const { data, error } = await supabase.auth.signUp({ email, password: senha, options: { data: { nome } } });
        if (error) throw error;
        if (!data.session) {
          setAviso("Conta criada. Confirme o e-mail enviado para você e depois entre com sua senha.");
          setModo("entrar");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
      }
      if (aoEntrar) await aoEntrar();
      window.location.assign(destino);
    } catch (e) {
      const mensagem = (e as Error).message;
      setErro(mensagem.includes("Invalid login") ? "E-mail ou senha incorretos." : mensagem.includes("Email not confirmed") ? "Confirme seu e-mail antes de entrar." : mensagem);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <form onSubmit={enviar}>
        {modo === "cadastrar" && <label>Seu nome<Input required value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" /></label>}
        <label>E-mail<Input required type="email" value={email} readOnly={!!emailFixo} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
        <label>Senha<Input required type="password" minLength={8} value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete={modo === "entrar" ? "current-password" : "new-password"} /></label>
        {erro && <div className="acesso-erro" role="alert">{erro}</div>}
        {aviso && <div className="acesso-ok" role="status">{aviso}</div>}
        <Button type="submit" disabled={ocupado}>{ocupado && <Loader2 className="spin" size={16} />}{modo === "entrar" ? "Entrar" : "Criar conta"}</Button>
      </form>
      {permitirCadastro && (
        <div className="acesso-rodape">
          <button type="button" className="acesso-link" onClick={() => { setModo(modo === "entrar" ? "cadastrar" : "entrar"); setErro(""); }}>
            {modo === "entrar" ? "Ainda não tenho conta" : "Já tenho conta"}
          </button>
        </div>
      )}
    </>
  );
}
