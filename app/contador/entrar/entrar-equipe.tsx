"use client";
// Entrada da equipe do escritório: senha e, em seguida, o código de 6 dígitos do aplicativo
// autenticador (segundo fator obrigatório). Sem cadastro de conta aqui: a equipe é incluída
// pelo titular do escritório. A sessão é a do portal do contador, separada da do cliente.
import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { criarClienteNavegador } from "@/lib/supabase/navegador";

const supabase = () => criarClienteNavegador("contador");

export default function EntrarEquipe() {
  const [etapa, setEtapa] = useState<"senha" | "codigo">("senha");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (p.get("etapa") === "codigo") setEtapa("codigo");
    if (p.get("erro") === "sem-acesso") setErro("Este acesso é exclusivo da equipe do escritório.");
  }, []);

  async function entrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setErro(""); setOcupado(true);
    try {
      const { error } = await supabase().auth.signInWithPassword({ email: f.email, password: f.senha });
      if (error) throw error;
      const { data: nivel } = await supabase().auth.mfa.getAuthenticatorAssuranceLevel();
      if (nivel?.nextLevel === "aal2" && nivel.currentLevel !== "aal2") { setEtapa("codigo"); return; }
      window.location.assign("/contador/seguranca"); // primeiro acesso: cadastrar o autenticador
    } catch (e) {
      const m = (e as Error).message;
      setErro(m.includes("Invalid login") ? "E-mail ou senha incorretos." : m);
    } finally {
      setOcupado(false);
    }
  }

  async function validar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const codigo = String(new FormData(e.currentTarget).get("codigo") ?? "").replace(/\D/g, "");
    setErro(""); setOcupado(true);
    try {
      const { data: fatores, error } = await supabase().auth.mfa.listFactors();
      if (error) throw error;
      const fator = fatores.totp.find((f) => f.status === "verified");
      if (!fator) { window.location.assign("/contador/seguranca"); return; }
      const { error: erroCodigo } = await supabase().auth.mfa.challengeAndVerify({ factorId: fator.id, code: codigo });
      if (erroCodigo) throw new Error("Código inválido ou expirado. Confira o aplicativo e tente de novo.");
      window.location.assign("/contador");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function sair() {
    await supabase().auth.signOut();
    window.location.assign("/contador/entrar");
  }

  return etapa === "senha" ? (
    <form onSubmit={entrar}>
      <label>E-mail<Input name="email" type="email" required autoComplete="username" /></label>
      <label>Senha<Input name="senha" type="password" required autoComplete="current-password" /></label>
      {erro && <div className="acesso-erro" role="alert">{erro}</div>}
      <Button type="submit" disabled={ocupado}>{ocupado && <Loader2 className="spin" size={16} />}Continuar</Button>
    </form>
  ) : (
    <form onSubmit={validar}>
      <label>Código do aplicativo autenticador
        <Input name="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
      </label>
      {erro && <div className="acesso-erro" role="alert">{erro}</div>}
      <Button type="submit" disabled={ocupado}>{ocupado && <Loader2 className="spin" size={16} />}Entrar</Button>
      <button type="button" className="acesso-link" onClick={sair}>Usar outra conta</button>
    </form>
  );
}
