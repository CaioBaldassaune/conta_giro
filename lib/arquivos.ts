// Arquivos no Storage (bucket privado "documentos"): caminho por escritório/empresa/documento e
// hash SHA-256 para registrar a versão exata de cada arquivo.
import { DomainError } from "./domain";
import type { ClienteSupabase } from "./supabase/servidor";

// Arquivos originais no bucket privado "documentos".
// Caminho: {escritorio_id}/{empresa_id}/{documento_id} (validado pela política do Storage).
const BUCKET = "documentos";

export const caminhoDocumento = (escritorioId: string, empresaId: string, documentoId: string) =>
  `${escritorioId}/${empresaId}/${documentoId}`;

export async function enviarArquivo(sb: ClienteSupabase, caminho: string, bytes: ArrayBuffer | Uint8Array, tipo: string) {
  const { error } = await sb.storage.from(BUCKET).upload(caminho, bytes, { contentType: tipo, upsert: false });
  if (error) throw new DomainError(`Não foi possível armazenar o arquivo: ${error.message}`, 500);
}

export async function baixarArquivo(sb: ClienteSupabase, caminho: string): Promise<Blob> {
  const { data, error } = await sb.storage.from(BUCKET).download(caminho);
  if (error || !data) throw new DomainError("Arquivo não encontrado.", 404);
  return data;
}

/** Melhor esforço: usuários não têm permissão de apagar; um arquivo órfão não expõe dados. */
export async function removerArquivo(sb: ClienteSupabase, caminho: string) {
  await sb.storage.from(BUCKET).remove([caminho]).catch(() => undefined);
}

export async function sha256(bytes: ArrayBuffer | Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, "0")).join("");
}
