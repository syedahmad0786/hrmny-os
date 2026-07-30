import { notFound } from "next/navigation";
import { getAuthMode } from "@/server/auth/session";
import GateDemoPage from "./gate-demo";

// Dev-only M1 acceptance probe (raw JSON dumps, health-signal triggers).
// Never reachable from a deployed build — getAuthMode() forces "supabase"
// whenever NODE_ENV=production, so this route 404s outside `next dev`.
export const dynamic = "force-dynamic";

export default function GatePage() {
  if (getAuthMode() !== "dev") notFound();
  return <GateDemoPage />;
}
