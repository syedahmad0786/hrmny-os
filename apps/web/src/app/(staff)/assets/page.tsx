import { notFound } from "next/navigation";
import { getAuthMode } from "@/server/auth/session";
import AssetsPage from "./assets-demo";

// Dev-only M1 DAM upload probe ("M1 demo asset", signed-URL JSON dump).
// The durable asset surface lives in Work (files view / attachments). Static
// generation evaluates getAuthMode() at build time: production builds without
// the explicit ALLOW_DEV_AUTH gate emit a not-found result and stay fail-closed.

export default function AssetsProbePage() {
  if (getAuthMode() !== "dev") notFound();
  return <AssetsPage />;
}
