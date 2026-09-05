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
              '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
            ["--font-body" as string]:
              '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
          } as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  );
}
