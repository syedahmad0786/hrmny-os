import { notFound } from "next/navigation";
import { getAuthMode } from "@/server/auth/session";
import AssetsPage from "./assets-demo";

// Dev-only M1 DAM upload probe ("M1 demo asset", signed-URL JSON dump).
// The durable asset surface lives in Work (files view / attachments); this
// probe 404s outside `next dev` because getAuthMode() forces "supabase" in prod.
export const dynamic = "force-dynamic";

export default function AssetsProbePage() {
  if (getAuthMode() !== "dev") notFound();
  return <AssetsPage />;
}
