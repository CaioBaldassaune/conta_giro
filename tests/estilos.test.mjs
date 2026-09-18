import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Proteção contra o arquivo de estilos ser truncado por engano (já aconteceu uma vez):
// as classes estruturais do portal e das telas novas precisam continuar presentes.
test("product.css mantém as regras estruturais do portal", () => {
  const css = readFileSync("app/product.css", "utf8");
  assert.ok(css.length > 40_000, `product.css ficou com ${css.length} bytes`);
  for (const classe of [".initial-state", ".topbar", ".workspace", ".acesso-cartao", ".painel-tabela", ".central-corpo", ".integracao-cartao", ".painel-select"]) {
    assert.ok(css.includes(classe), `regra ausente: ${classe}`);
  }
  assert.match(readFileSync("app/globals.css", "utf8"), /@import "\.\/product\.css";/);
});
