"use client";
// Cadastro do segundo fator (TOTP) da equipe: o contador lê o QR code no aplicativo autenticador
// (Google Authenticator, Microsoft Authenticator, 1Password...) e confirma com o código gerado.
// Sem isso o banco não libera nenhum dado da carteira (ver migração mfa_equipe_e_cofre).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { criarClienteNavegador } from "@/lib/supabase/navegador";

const supabase = () => criarClienteNavegador("contador");

export default function CadastrarFator() {
  const [fator, setFator] = useState<{ id: string; qr: string; segredo: string } | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const iniciado = useRef(false);

  useEffect(() => {
    if (iniciado.current) return;
    iniciado.current = true;
    (async () => {
      try {
        // Remove tentativas anteriores não confirmadas antes de gerar um QR novo.
        const { data: lista } = await supabase().auth.mfa.listFactors();
        for (const f of lista?.all ?? []) if (f.status === "unverified") await supabase().auth.mfa.unenroll({ factorId: f.id });
        const { data, error } = await supabase().auth.mfa.enroll({ factorType: "totp", friendlyName: `ContaGiro ${new Date().toISOString().slice(0, 16)}` });
        if (error) throw error;
        setFator({ id: data.id, qr: data.totp.qr_code, segredo: data.totp.secret });
      } catch (e) {
        setErro((e as Error).message);
      }
    })();
  }, []);

  async function confirmar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!fator) return;
    const codigo = String(new FormData(e.currentTarget).get("codigo") ?? "").replace(/\D/g, "");
    setErro(""); setOcupado(true);
    try {
      const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId: fator.id, code: codigo });
      if (error) throw new Error("Código inválido. Confira se o horário do celular está automático e tente de novo.");
      window.location.assign("/contador");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={confirmar}>
      <ol className="acesso-passos">
        <li>Abra um aplicativo autenticador no celular.</li>
        <li>Leia o QR code abaixo (ou digite a chave).</li>
        <li>Informe o código de 6 dígitos que aparecer.</li>
      </ol>
      {fator ? (
        <div className="acesso-qr">
          {/* eslint-disable-next-line @next/next/no-img-element -- QR em data URL gerado pelo Supabase */}
          <img src={fator.qr} alt="QR code para o aplicativo autenticador" width="180" height="180" />
          <code>{fator.segredo}</code>
        </div>
      ) : !erro && <p className="muted"><Loader2 className="spin" size={16} /> Gerando o QR code…</p>}
      <label>Código de 6 dígitos<Input name="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required /></label>
      {erro && <div className="acesso-erro" role="alert">{erro}</div>}
      <Button type="submit" disabled={ocupado || !fator}>{ocupado && <Loader2 className="spin" size={16} />}Ativar e entrar</Button>
    </form>
  );
}
