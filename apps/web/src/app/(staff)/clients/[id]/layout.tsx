import type { ReactNode } from "react";

const DEMO_CLIENT_ID = "c1000000-0000-4000-8000-0000000000a4";

/**
 * Emit one deterministic shell for browser acceptance. Unknown client IDs
 * remain dynamic at runtime; data is still loaded through the scoped tRPC
 * boundary rather than embedded in the static document.
 */
export function generateStaticParams() {
  return [{ id: DEMO_CLIENT_ID }];
}

export const dynamicParams = true;

export default function ClientDetailLayout({ children }: { children: ReactNode }) {
  return children;
}
