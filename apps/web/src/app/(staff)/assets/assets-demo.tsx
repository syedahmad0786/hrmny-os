"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

export default function AssetsPage() {
  const utils = trpc.useUtils();
  const list = trpc.assets.list.useQuery();
  const create = trpc.assets.create.useMutation({
    onSuccess: () => void utils.assets.list.invalidate(),
  });
  const upload = trpc.assets.uploadVersion.useMutation({
    onSuccess: () => void utils.assets.list.invalidate(),
  });
  const signed = trpc.assets.signedUrl.useMutation();
  const [title, setTitle] = useState("M1 demo asset");
  const [lastSigned, setLastSigned] = useState<unknown>(null);

  async function onCreateAndUpload() {
    const asset = await create.mutateAsync({ title });
    const contentBase64 = btoa(`hrmny-dam-demo-${Date.now()}`);
    const version = await upload.mutateAsync({
      assetId: asset.assetId,
      fileName: "demo.txt",
      contentType: "text/plain",
      contentBase64,
    });
    const url = await signed.mutateAsync({
      assetId: asset.assetId,
      versionId: version.assetVersionId,
    });
    setLastSigned({ version, url });
  }

  return (
    <main className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold">DAM upload</h1>
      <p className="text-muted">
        ObjectStore adapter (memory locally; Supabase Storage when configured).
        Versions are append-only.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Title
          <input
            className="rounded border border-sand bg-white px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <Button
          type="button"
          onClick={() => void onCreateAndUpload()}
          disabled={create.isPending || upload.isPending}
        >
          Create + upload v1 + signed URL
        </Button>
      </div>
      {lastSigned ? (
        <pre className="overflow-x-auto rounded-lg border border-sand bg-white/70 p-4 text-sm">
          {JSON.stringify(lastSigned, null, 2)}
        </pre>
      ) : null}
      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <h2 className="font-medium">Assets</h2>
        <pre className="mt-2 overflow-x-auto text-sm">
          {JSON.stringify(list.data ?? [], null, 2)}
        </pre>
      </section>
    </main>
  );
}
