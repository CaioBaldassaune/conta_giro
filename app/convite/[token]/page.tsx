"use client";
import { use, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CartaoAcesso, FormularioAcesso } from "@/app/acesso/entrar-form";
import { criarClienteNavegador } from "@/lib/supabase/navegador";
import { sair } from "@/app/acesso/primeiro-acesso";

// Aceite de convite: a pessoa cria a conta (ou entra) com o e-mail convidado e o
// vínculo com a empresa é feito pela função aceitar_convite no banco.
export default function AceitarConvite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [logado, setLogado] = useState<string | null | undefined>(undefined);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    criarClienteNavegador("cliente").auth.getUser().then(({ data }) => setLogado(data.user?.email ?? null));
  }, []);

  async function aceitar() {
    setErro(""); setOcupado(true);
    const { data, error } = await criarClienteNavegador("cliente").rpc("aceitar_convite", { p_token: token });
    if (error) {
      setErro(error.message);
      setOcupado(false);
      throw error;
    }
    window.location.assign(data?.portal === "contador" ? "/contador" : "/cliente");
  }

  if (logado === undefined) return <CartaoAcesso titulo="Convite ContaGiro"><Loader2 className="spin" /></CartaoAcesso>;

  if (logado) return (
    <CartaoAcesso titulo="Aceitar convite" descricao={`Você está conectado como ${logado}. O convite precisa ter sido enviado para este e-mail.`}>
      {erro && <div className="acesso-erro" role="alert">{erro}</div>}
      <Button onClick={() => aceitar().catch(() => undefined)} disabled={ocupado}>{ocupado && <Loader2 className="spin" size={16} />}Aceitar e acessar</Button>
      <div className="acesso-rodape"><button type="button" className="acesso-link" onClick={() => sair(`/convite/${token}`)}>Usar outra conta</button></div>
    </CartaoAcesso>
  );

  return (
    <CartaoAcesso titulo="Você foi convidado" descricao="Crie sua conta com o e-mail que recebeu o convite (ou entre, se já tiver conta).">
      {erro && <div className="acesso-erro" role="alert">{erro}</div>}
      <FormularioAcesso destino="/cliente" permitirCadastro aoEntrar={aceitar} />
    </CartaoAcesso>
  );
}
