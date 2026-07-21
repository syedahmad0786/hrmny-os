"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

export default function ConnectionsPage() {
  const utils = trpc.useUtils();
  const list = trpc.connections.list.useQuery({ scope: "staff" });
  const start = trpc.connections.startOAuth.useMutation({
    onSuccess: () => void utils.connections.list.invalidate(),
  });
  const complete = trpc.connections.completeOAuth.useMutation({
    onSuccess: () => void utils.connections.invalidate(),
  });
  const canva = trpc.connections.canvaListDesigns.useQuery(undefined, {
    enabled: false,
  });
  const [redirect, setRedirect] = useState<string | null>(null);
  const [canvaMsg, setCanvaMsg] = useState<string | null>(null);

  async function connect(toolkit: "gmail" | "linkedin" | "canva" | "calendar") {
    const result = await start.mutateAsync({ toolkit });
    setRedirect(result.redirectUrl);
  }

  async function connectCanvaDemo() {
    await start.mutateAsync({ toolkit: "canva" });
    const row = await complete.mutateAsync({ toolkit: "canva" });
    setRedirect(null);
    setCanvaMsg(`Canva connected (stub): ${row.connectionAccountId}`);
    const smoke = await canva.refetch();
    if (smoke.data?.ok) {
      setCanvaMsg(
        `Canva connected · ${smoke.data.designs.length} stub designs listed`,
      );
    }
  }

  return (
    <main className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold">Connections</h1>
      <p className="text-muted">
        Composio OAuth — Canva is connect-only (no Canva clone). Redirect URLs
        are placeholders until <code>COMPOSIO_API_KEY</code> is set.
      </p>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <h2 className="font-display text-lg">Canva toolkit</h2>
        <p className="mt-1 text-sm text-muted">
          M4 demo: connect stub → list/export smoke. Deep ads analytics parked.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" onClick={() => void connectCanvaDemo()}>
            Connect Canva (Composio stub)
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              void canva.refetch().then((r) => {
                if (!r.data?.ok) {
                  setCanvaMsg(r.data?.reason ?? "Not connected");
                } else {
                  setCanvaMsg(
                    `Designs: ${r.data.designs.map((d) => d.title).join("; ")}`,
                  );
                }
              })
            }
          >
            List Canva designs (smoke)
          </Button>
        </div>
        {canvaMsg ? <p className="mt-3 text-sm text-ink">{canvaMsg}</p> : null}
      </section>

      <div className="flex flex-wrap gap-2">
        {(["gmail", "linkedin", "canva", "calendar"] as const).map((t) => (
          <Button
            key={t}
            type="button"
            variant="ghost"
            onClick={() => void connect(t)}
            disabled={start.isPending}
          >
            Connect {t}
          </Button>
        ))}
      </div>
      {redirect ? (
        <p className="text-sm">
          OAuth redirect (stub):{" "}
          <a className="text-ochre underline" href={redirect}>
            {redirect}
          </a>
        </p>
      ) : null}
      <pre className="overflow-x-auto rounded-lg border border-sand bg-white/70 p-4 text-sm">
        {JSON.stringify(list.data ?? [], null, 2)}
      </pre>
    </main>
  );
}
