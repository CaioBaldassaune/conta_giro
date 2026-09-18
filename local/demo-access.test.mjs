import test from "node:test";
import assert from "node:assert/strict";
import { localDemoAccess, localDemoPlugin, LOCAL_ORIGIN } from "./demo-access.mjs";

function request(changes = {}) {
  return {
    url: "/api/state",
    socket: { remoteAddress: "127.0.0.1" },
    headers: { host: "127.0.0.1:5173" },
    rawHeaders: ["Host", "127.0.0.1:5173"],
    ...changes,
  };
}
function run(req) {
  let allowed = false;
  const res = { statusCode: 200, setHeader() {}, end() {} };
  localDemoAccess(req, res, () => { allowed = true; });
  return { allowed, status: res.statusCode };
}

test("local demo supplies a fixed identity and replaces forged identity headers", () => {
  const req = request();
  req.headers["oai-authenticated-user-id"] = "another-user";
  req.rawHeaders.push("OAI-Authenticated-User-ID", "another-user");
  assert.equal(run(req).allowed, true);
  assert.equal(req.headers["oai-authenticated-user-id"], "contagiro-local-demo-accountant-v2");
  assert.equal(req.rawHeaders.includes("another-user"), false);
  const sameOrigin = request();
  sameOrigin.headers.origin = LOCAL_ORIGIN;
  assert.equal(run(sameOrigin).allowed, true);
});

test("local demo rejects remote sockets, external hosts, and cross-origin requests", () => {
  const cases = [
    request({ socket: { remoteAddress: "192.168.1.10" } }),
    request({ headers: { host: "example.com:5173" } }),
    request({ headers: { host: "127.0.0.1:5173", origin: "https://example.com" } }),
    request({ headers: { host: "127.0.0.1:5173", "sec-fetch-site": "cross-site" } }),
  ];
  for (const req of cases) {
    assert.deepEqual(run(req), { allowed: false, status: 403 });
    assert.equal(req.headers["oai-authenticated-user-id"], undefined);
  }
});

test("demo cannot be used in a production build or with a network listener", () => {
  const plugin = localDemoPlugin();
  const safe = { command: "serve", isProduction: false, server: { host: "127.0.0.1", port: 5173, strictPort: true } };
  assert.equal(plugin.apply, "serve");
  assert.doesNotThrow(() => plugin.configResolved(safe));
  assert.throws(() => plugin.configResolved({ ...safe, command: "build" }));
  assert.throws(() => plugin.configResolved({ ...safe, isProduction: true }));
  assert.throws(() => plugin.configResolved({ ...safe, server: { ...safe.server, host: "0.0.0.0" } }));
  assert.throws(() => plugin.configResolved({ ...safe, server: { ...safe.server, strictPort: false } }));
});
