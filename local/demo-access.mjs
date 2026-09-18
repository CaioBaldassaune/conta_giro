// Test identity, injected only by the explicitly selected local development runner.
// This file is not imported by the application, Worker, or production Vite config.
export const LOCAL_HOST = "127.0.0.1";
export const LOCAL_PORT = 5173;
export const LOCAL_ORIGIN = `http://${LOCAL_HOST}:${LOCAL_PORT}`;

export function localDemoAccess(request, response, next) {
  const address = request.socket.remoteAddress;
  const localAddress = address === LOCAL_HOST || address === "::ffff:127.0.0.1";
  const host = request.headers.host;
  const origin = request.headers.origin;
  const site = request.headers["sec-fetch-site"];
  if (!localAddress || host !== `${LOCAL_HOST}:${LOCAL_PORT}` ||
      (origin !== undefined && origin !== LOCAL_ORIGIN) || site === "cross-site") {
    response.statusCode = 403;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(`Teste local: acesse ${LOCAL_ORIGIN} neste computador.`);
    return;
  }

  // Never accept an identity supplied by the caller, even in this demo.
  const isIdentity = (key) => key.toLowerCase().startsWith("oai-authenticated-user-");
  for (const key of Object.keys(request.headers)) {
    if (isIdentity(key)) delete request.headers[key];
  }
  const raw = [];
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    if (!isIdentity(request.rawHeaders[i])) raw.push(request.rawHeaders[i], request.rawHeaders[i + 1]);
  }
  const demo = {
    "oai-authenticated-user-id": "contagiro-local-demo-accountant-v2",
    "oai-authenticated-user-email": "contador@contagiro.test",
    "oai-authenticated-user-full-name": encodeURIComponent("Contador · teste local"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  Object.assign(request.headers, demo);
  for (const [key, value] of Object.entries(demo)) raw.push(key, value);
  request.rawHeaders = raw;

  if (["/signin-with-chatgpt", "/signout-with-chatgpt", "/callback"].includes(
    new URL(request.url, LOCAL_ORIGIN).pathname,
  )) {
    response.statusCode = 302;
    response.setHeader("Location", "/");
    response.end();
    return;
  }
  next();
}

export function localDemoPlugin() {
  return {
    name: "contagiro-local-demo-only",
    apply: "serve",
    enforce: "pre",
    configResolved(config) {
      if (config.command !== "serve" || config.isProduction ||
          config.server.host !== LOCAL_HOST || config.server.port !== LOCAL_PORT ||
          !config.server.strictPort) {
        throw new Error("O acesso demonstrativo exige desenvolvimento local em 127.0.0.1:5173.");
      }
    },
    configureServer(server) {
      server.middlewares.use(localDemoAccess);
    },
  };
}
