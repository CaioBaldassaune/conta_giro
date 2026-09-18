#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { localDemoPlugin, LOCAL_HOST, LOCAL_PORT, LOCAL_ORIGIN } from "../local/demo-access.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
process.chdir(root);
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check")) {
  throw new Error("Uso: node scripts/local-dev.mjs [--check]");
}
if (process.env.NODE_ENV === "production") {
  throw new Error("Este inicializador é exclusivo para teste local. NODE_ENV não pode ser production.");
}
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  throw new Error("Instale Node.js 22.13 ou superior. Recomendado: Node.js 24 LTS.");
}

let wrangler, vite;
try {
  const pkg = require.resolve("wrangler/package.json");
  wrangler = resolve(dirname(pkg), "bin/wrangler.js");
  vite = await import("vite");
} catch (error) {
  console.error("Dependências indisponíveis. Execute npm ci na pasta do projeto.");
  throw error;
}
const config = JSON.parse(await readFile(resolve(root, "local/wrangler.json"), "utf8"));
const hosting = JSON.parse(await readFile(resolve(root, ".openai/hosting.json"), "utf8"));
if (hosting.d1 !== "DB" || hosting.r2 !== "DOCUMENTS" ||
    config.d1_databases[0].database_id !== "00000000-0000-4000-8000-000000000000") {
  throw new Error("Os bindings locais precisam corresponder aos bindings do código publicado.");
}
process.env.NODE_ENV = "development";
process.env.WRANGLER_SEND_METRICS = "false";
process.env.WRANGLER_WRITE_LOGS = "false";
process.env.WRANGLER_LOG_PATH = resolve(root, ".wrangler/logs");
process.env.MINIFLARE_REGISTRY_PATH = resolve(root, ".wrangler/registry");
await mkdir(resolve(root, ".wrangler"), { recursive: true });

console.log("ContaGiro: preparando o banco de teste neste computador.");
await new Promise((accept, reject) => {
  const child = spawn(process.execPath, [
    wrangler, "d1", "migrations", "apply", "DB", "--local",
    "--config", resolve(root, "local/wrangler.json"),
    "--persist-to", resolve(root, ".wrangler/state"),
  ], { cwd: root, env: process.env, stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
  child.on("error", reject);
  child.on("exit", (code, signal) => code === 0 ? accept() : reject(
    new Error(`Não foi possível preparar o banco local (${signal ?? code}).`),
  ));
});

if (args.includes("--check")) {
  console.log("Dependências e migrações locais preparadas. Nenhum servidor foi iniciado.");
} else {
  const server = await vite.createServer({
    root,
    configFile: resolve(root, "vite.config.ts"),
    mode: "development",
    plugins: [localDemoPlugin()],
    server: {
      host: LOCAL_HOST, port: LOCAL_PORT, strictPort: true,
      allowedHosts: [LOCAL_HOST], cors: false, open: false,
    },
  });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  try {
    await server.listen();
    console.log(`\nContaGiro disponível em ${LOCAL_ORIGIN}`);
    console.log("Acesso: contador de demonstração. Dados fictícios e armazenamento local.");
    console.log("Este modo não deve ser publicado ou exposto por túnel/reverse proxy. Ctrl+C para encerrar.\n");
  } catch (error) {
    await server.close();
    throw error;
  }
}
