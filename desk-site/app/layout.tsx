import type { CSSProperties, ReactNode } from "react";
import "./globals.css";
import "./crm.css";

export const metadata = {
  title: "hrmny OS — Build desk",
  description: "Team desk + CRM + client portal for Creative Harmony",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html
      lang="en"
      style={
        {
          "--font-display":
            '"Aptos Display", "Segoe UI Variable Display", "Arial Narrow", sans-serif',
          "--font-body":
            'Montserrat, Aptos, "Segoe UI Variable Text", "Segoe UI", sans-serif',
        } as CSSProperties
      }
    >
      <body>
        <div className="grain" aria-hidden />
        {children}
      </body>
    </html>
  );
}
