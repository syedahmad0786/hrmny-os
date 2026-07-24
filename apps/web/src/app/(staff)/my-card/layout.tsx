import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PwaRegister } from "./pwa-register";

export const metadata: Metadata = {
  title: "My digital card · hrmny OS",
  manifest: "/manifest.webmanifest",
};

export default function MyCardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PwaRegister />
      {children}
    </>
  );
}
