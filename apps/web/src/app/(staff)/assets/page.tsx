import { notFound } from "next/navigation";
import { getAuthMode } from "@/server/auth/session";

// Dev-only M1 DAM upload probe ("M1 demo asset", signed-URL JSON dump).
// The durable asset surface lives in Work (files view / attachments); this
// probe 404s outside `next dev` because getAuthMode() forces "supabase" in prod.
export const dynamic = "force-dynamic";

export default function AssetsProbePage() {
  if (getAuthMode() !== "dev") notFound();
  return (
    <main className="flex flex-col gap-3">
      <h1 className="font-display text-3xl font-semibold">DAM moved to Work</h1>
      <p className="text-muted">
        Production assets are created, versioned, reviewed and downloaded from
        the Files section of a Work task. This development-only route contains
        no data or mutation controls.
      </p>
    </main>
  );
}
