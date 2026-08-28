import { notFound } from "next/navigation";
import { getAuthMode } from "@/server/auth/session";
import GateDemoPage from "./gate-demo";

// Dev-only M1 acceptance probe (raw JSON dumps, health-signal triggers).
// Static generation evaluates getAuthMode() at build time: a production build
// without the explicit ALLOW_DEV_AUTH gate emits not-found and stays closed.

export default function GatePage() {
  if (getAuthMode() !== "dev") notFound();
  return <GateDemoPage />;
}
