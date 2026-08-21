"use client";

import { trpc } from "@/lib/trpc";
import { useEffect, useState } from "react";

/** Resolve and show a portal asset preview via signed / direct URL. */
export function PortalAssetPreview(props: {
  assetId: string;
  title: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const signed = trpc.portal.assets.signedUrl.useMutation();

  useEffect(() => {
    let cancelled = false;
    void signed
      .mutateAsync({ assetId: props.assetId })
      .then((result) => {
        if (cancelled) return;
        if (result.ok && "url" in result && typeof result.url === "string") {
          setUrl(result.url);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // Resolve once per asset id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.assetId]);

  if (failed) {
    return (
      <p className="text-xs text-muted">Preview unavailable for {props.title}</p>
    );
  }
  if (!url) {
    return <p className="text-xs text-muted">Loading preview…</p>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={props.title}
      className="mt-2 max-h-48 w-full object-contain bg-[#F7F3EC]"
    />
  );
}
