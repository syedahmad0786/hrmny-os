import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "My digital card · hrmny OS",
};

export default function MyCardLayout({ children }: { children: ReactNode }) {
  return children;
}
