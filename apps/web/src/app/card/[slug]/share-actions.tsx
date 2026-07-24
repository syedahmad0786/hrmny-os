"use client";

import { useState } from "react";

export function ShareActions({ title }: { title: string }) {
  const [status, setStatus] = useState("");

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        setStatus("Shared");
      } else {
        await navigator.clipboard.writeText(url);
        setStatus("Link copied");
      }
    } catch (error) {
      if ((error as DOMException).name !== "AbortError")
        setStatus("Could not share");
    }
  }

  return (
    <div className="mt-6 text-center">
      <button
        type="button"
        className="rounded-full px-5 py-2 text-sm font-semibold text-white"
        style={{ backgroundColor: "var(--card-accent)" }}
        onClick={() => void share()}
      >
        Share or copy link
      </button>
      {status ? (
        <p className="mt-2 text-xs text-neutral-500" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
