import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ContaGiro | Seu negócio no giro certo",
  description: "Finanças, documentos e fechamento mensal em um único lugar.",
  icons: {
    icon: "/brand/favicon.ico",
    shortcut: "/brand/favicon.ico",
    apple: "/brand/appicon-180.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
