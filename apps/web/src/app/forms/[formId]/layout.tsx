import type { ReactNode } from "react";

/** Emit the manifest's harmless unavailable-form fixture for route acceptance. */
export function generateStaticParams() {
  return [{ formId: "demo-form" }];
}

export const dynamicParams = true;

export default function PublicFormLayout({ children }: { children: ReactNode }) {
  return children;
}
