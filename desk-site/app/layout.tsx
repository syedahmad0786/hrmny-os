import type { ReactNode } from "react";
import { Montserrat, Syne } from "next/font/google";
import "./globals.css";
import "./crm.css";

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

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
    <html lang="en" className={`${syne.variable} ${montserrat.variable}`}>
      <body>
        <div className="grain" aria-hidden />
        {children}
      </body>
    </html>
  );
}
