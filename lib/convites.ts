// Convite de acesso do cliente: token aleatório de uso único; no banco só fica o hash.
import { createHash, randomBytes } from "node:crypto";
import { requireThat } from "./domain";
import { erroDoBanco } from "./repositorio";
import type { Contexto } from "./server";
import { PAPEIS } from "./traducao";

/**
 * Cria um convite para um usuário do cliente e devolve o link de aceite.
 * Apenas o hash do token fica no banco; o token em claro existe só no link.
 */
export async function criarConvite(ctx: Contexto, dados: { email: unknown; role: unknown }, origem: string) {
  requireThat(ctx.role === "accountant" || ctx.role === "owner", "Seu perfil não permite convidar pessoas.", 403);
  const email = String(dados.email ?? "").trim().toLowerCase();
  requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "E-mail inválido.");
  const papel = PAPEIS.banco(dados.role);
  requireThat(papel && ["socio", "financeiro", "emissor", "consulta"].includes(papel), "Perfil inválido.");

  const token = randomBytes(24).toString("base64url");
  const { error } = await ctx.sb.from("convites").insert({
    escritorio_id: ctx.escritorioId,
    empresa_id: ctx.company.id,
    email,
    papel,
    token_hash: createHash("sha256").update(token).digest("hex"),
    convidado_por: ctx.u.id,
  });
  if (error) {
    requireThat(error.code !== "23505", "Já existe um convite pendente para este e-mail nesta empresa.", 409);
    throw erroDoBanco(error);
  }
  return `${origem}/convite/${token}`;
}
