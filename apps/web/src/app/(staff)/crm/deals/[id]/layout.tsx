import type { ReactNode } from "react";

const ACCEPTANCE_DEAL_IDS = [
  "e0000000-0000-4000-8000-000000000001",
  "e0000000-0000-4000-8000-000000000005",
] as const;

/** Static shells for repository-owned demo fixtures; all other deals stay dynamic. */
export function generateStaticParams() {
  return ACCEPTANCE_DEAL_IDS.map((id) => ({ id }));
}

export const dynamicParams = true;

export default function DealDetailLayout({ children }: { children: ReactNode }) {
  return children;
}
