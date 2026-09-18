import ts from "typescript";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

// Transpila os módulos puros de lib/ para .domain-tests/ e roda os testes com node:test.
const MODULOS = ["domain", "importer", "seed", "contagiro", "reporting", "traducao", "repositorio", "carteira", "certificado", "serpro-formato", "nfse/dps", "nfse/assinatura"];
const LOCAIS = /(['"])\.\/(domain|contagiro|reporting|traducao|repositorio|carteira|certificado|serpro-formato|dps|assinatura)\1/g;

for (const nome of MODULOS) {
  const entrada = await readFile(`lib/${nome}.ts`, "utf8");
  const saida = ts.transpileModule(entrada, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(LOCAIS, "$1./$2.mjs$1");
  const destino = `.domain-tests/${nome}.mjs`;
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, saida);
}

const testes = ["domain", "contagiro", "traducao", "carteira", "serpro", "nfse"].map((t) => `tests/${t}.test.mjs`);
const resultado = spawnSync(process.execPath, ["--test", ...testes], { stdio: "inherit" });
process.exit(resultado.status ?? 1);
