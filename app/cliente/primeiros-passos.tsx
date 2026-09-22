"use client";
// Primeiros passos do cliente, na tela Início: o que ele mesmo faz depois do cadastro.
// Cada item tem uma única ação; o que já está pronto aparece marcado e o cartão some quando
// tudo estiver concluído. O certificado digital é enviado aqui pelo próprio sócio e vai direto
// para o cofre (o arquivo e a senha nunca voltam para a tela).
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PageKey } from "../ui";

type Situacao = { banco: boolean; certificado: { titular: string; valido_ate: string } | null; podeEnviarCertificado: boolean };

export default function PrimeirosPassos({ empresaId, contatos, gradeConfirmada, irPara }: {
  empresaId: string; contatos: number; gradeConfirmada: boolean; irPara: (p: PageKey) => void;
}) {
  const [s, setS] = useState<Situacao | null>(null);
  const [enviarCert, setEnviarCert] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    const [of, cert] = await Promise.all([
      fetch(`/api/openfinance/contas?empresa=${empresaId}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/nfse/certificado?empresa=${empresaId}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ]);
    setS({ banco: (of?.contas?.length ?? 0) > 0, certificado: cert?.certificado ?? null, podeEnviarCertificado: !!cert?.podeEnviar });
  }, [empresaId]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function enviarCertificado(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set("empresaId", empresaId);
    setEnviando(true);
    try {
      const res = await fetch("/api/nfse/certificado", { method: "POST", body: form });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(d.message);
      setEnviarCert(false);
      await carregar();
    } catch (erro) {
      toast.error((erro as Error).message, { duration: 10000 });
    } finally {
      setEnviando(false);
    }
  }

  if (!s) return null;
  const itens = [
    { feito: s.banco, titulo: "Conectar a conta do banco", texto: "O extrato chega sozinho todo dia para você categorizar.", acao: <Button size="sm" onClick={() => irPara("finance")}>Conectar</Button> },
    { feito: !!s.certificado, titulo: "Enviar o certificado digital (A1)", texto: s.certificado ? `${s.certificado.titular} • válido até ${new Date(s.certificado.valido_ate).toLocaleDateString("pt-BR")}` : "Usado para emitir suas notas fiscais. Fica guardado de forma criptografada.", acao: s.podeEnviarCertificado ? <Button size="sm" variant="outline" onClick={() => setEnviarCert((v) => !v)}>Enviar</Button> : <span className="muted">O sócio da empresa envia.</span> },
    { feito: contatos > 0, titulo: "Cadastrar clientes e fornecedores", texto: "Assim reconhecemos quem pagou e quem recebeu no extrato.", acao: <Button size="sm" variant="outline" onClick={() => irPara("contacts")}>Cadastrar</Button> },
    { feito: gradeConfirmada, titulo: "Configuração dos impostos", texto: gradeConfirmada ? "Concluída pelo seu contador." : "Com o seu contador. Você não precisa fazer nada.", acao: null },
  ];
  if (itens.every((i) => i.feito)) return null;
  const feitos = itens.filter((i) => i.feito).length;

  return (
    <section className="passos-cliente" aria-labelledby="passos-titulo">
      <div className="passos-topo">
        <h2 id="passos-titulo">Primeiros passos</h2>
        <span className="muted">{feitos} de {itens.length}</span>
      </div>
      <div className="passos-barra" aria-hidden="true"><span style={{ width: `${(feitos / itens.length) * 100}%` }} /></div>
      <ul>
        {itens.map((i) => (
          <li key={i.titulo} className={i.feito ? "feito" : ""}>
            <span className="passos-marca">{i.feito && <Check size={14} />}</span>
            <div><strong>{i.titulo}</strong><p>{i.texto}</p></div>
            {!i.feito && i.acao}
          </li>
        ))}
      </ul>
      {enviarCert && (
        <form className="passos-certificado" onSubmit={enviarCertificado}>
          <label>Arquivo do certificado (.pfx ou .p12)<Input name="certificado" type="file" accept=".pfx,.p12" required /></label>
          <label>Senha do certificado<Input name="senha" type="password" autoComplete="off" required /></label>
          <p className="muted">Só aceitamos o e-CNPJ da sua empresa. Ninguém consegue ver o arquivo ou a senha depois de enviados.</p>
          <Button type="submit" disabled={enviando}>{enviando && <Loader2 className="spin" size={15} />}Enviar certificado</Button>
        </form>
      )}
    </section>
  );
}
