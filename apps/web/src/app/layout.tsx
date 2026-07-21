import "@hrmny/ui/tokens.css";
import "./globals.css";
import "./crm.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Montserrat, Syne } from "next/font/google";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
});

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  display: "swap",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "hrmny OS",
  description: "Creative Harmony internal operating system",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${montserrat.variable} ${syne.variable}`}>
      <body
        className="min-h-screen bg-paper font-body text-ink antialiased"
        style={
          {
            ["--font-display" as string]: "var(--font-syne)",
            ["--font-body" as string]: "var(--font-montserrat)",
          } as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  );
}
