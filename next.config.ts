import type { NextConfig } from "next";

// Cabeçalhos de segurança em todas as respostas.
// - HSTS: só HTTPS no navegador (a Vercel já serve HTTPS).
// - CSP: scripts, estilos e conexões só da própria origem, do Supabase (dados e login),
//   do ViaCEP (preenchimento de endereço no navegador) e da barra da Vercel nos Previews.
//   'unsafe-inline' é exigido pelo Next para a hidratação; 'unsafe-eval' só em desenvolvimento.
// - frame-ancestors/X-Frame-Options: o app não pode ser embutido em outro site (clickjacking).
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://*.supabase.co";
const desenvolvimento = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${desenvolvimento ? " 'unsafe-eval'" : ""} https://vercel.live`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabase} ${supabase.replace(/^https/, "wss")} https://viacep.com.br https://vercel.live wss://ws-us3.pusher.com`,
  "frame-src https://vercel.live",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      ],
    }];
  },
};

export default nextConfig;
