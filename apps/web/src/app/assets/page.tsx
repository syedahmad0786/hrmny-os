import { notFound } from "next/navigation";
import { getAuthMode } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default function AssetsProbePage() {
  if (getAuthMode() !== "dev") notFound();
  return (
    <main className="flex flex-col gap-3 p-8">
      <h1 className="font-display text-3xl font-semibold">DAM moved to Work</h1>
      <p className="text-muted">
        Production assets are created, versioned, reviewed and downloaded from
        the Files section of a Work task. This development-only route contains
        no data or mutation controls.
      </p>
    </main>
  );
}
