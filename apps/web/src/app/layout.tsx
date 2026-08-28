import "@hrmny/ui/tokens.css";
import "./globals.css";
import "./crm.css";
import "./hrmny-chat.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "hrmny OS",
  description: "Creative Harmony internal operating system",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        className="min-h-screen bg-paper font-body text-ink antialiased"
        style={
          {
            ["--font-display" as string]:
              '"Aptos Display", "Segoe UI Variable Display", "Arial Narrow", sans-serif',
            ["--font-body" as string]:
              'Montserrat, Aptos, "Segoe UI Variable Text", "Segoe UI", sans-serif',
          } as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  );
}
