"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { demoBlockerConnectionsPath } from "@/lib/demo-blocker-anchor";
import { formatReadyLlmLine, type ReadySmoke } from "@/lib/ready-smoke";

/** Sidebar `/api/ready` strip for Chat closed-loop and OS settle runs. */
export function ChatReadyStrip() {
  const [ready, setReady] = useState<ReadySmoke | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/ready")
      .then((r) => r.json())
      .then((body: ReadySmoke) => {
        if (!cancelled) setReady(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return null;

  const blockers = ready.blockers ?? [];
  const liveReady = blockers.length === 0;

  return (
    <div className="hrmny-chat-ready-strip" data-testid="chat-ready-strip">
      <p className="hrmny-chat-ready-llm" data-testid="chat-ready-llm">
        Ready · {formatReadyLlmLine(ready)}
      </p>
      <p className="hrmny-chat-ready-blockers" data-testid="chat-ready-blockers">
        {liveReady
          ? "Live demo integrations ready"
          : `${blockers.length} demo blocker${blockers.length === 1 ? "" : "s"}`}
      </p>
      {blockers.length > 0 ? (
        <ul className="hrmny-chat-ready-list" data-testid="chat-ready-blocker-list">
          {blockers.slice(0, 2).map((item) => {
            const href = demoBlockerConnectionsPath(item);
            return (
              <li key={item}>
                {href ? (
                  <Link href={href} className="hrmny-chat-ready-link">
                    {item}
                  </Link>
                ) : (
                  item
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="hrmny-chat-ready-links">
        <Link href="/crm" className="hrmny-chat-ready-link" data-testid="chat-ready-crm">
          CRM hub
        </Link>
        <Link
          href="/settings/connections"
          className="hrmny-chat-ready-link"
          data-testid="chat-ready-connections"
        >
          Connections
        </Link>
      </p>
    </div>
  );
}
