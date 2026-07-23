"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { CrmBtn, CrmEmpty, CrmPageHeader, CrmTag } from "@/components/crm/ui";

export default function CrmSeamsPage() {
  const connections = trpc.connections.list.useQuery({ scope: "staff" });

  const byToolkit = new Map(
    (connections.data ?? []).map((c) => [c.toolkit, c]),
  );

  const cards = [
    {
      key: "gmail" as const,
      mark: "GM",
      title: "Gmail",
      copy: "Primary outbound channel. hrmny keeps the seam explicit instead of cloning the inbox.",
      action: "Open connections",
    },
    {
      key: "calendar" as const,
      mark: "CA",
      title: "Google Calendar",
      copy: "Two-way meeting visibility for discovery and delivery cadences.",
      action: "Open Calendar",
    },
    {
      key: "linkedin" as const,
      mark: "LI",
      title: "LinkedIn",
      copy: "Copy-draft only in V1 — approved text is pasted manually by staff.",
      action: "View rule",
    },
  ];

  return (
    <main>
      <CrmPageHeader
        title="Email + calendar"
        description="Connection status and direct seams — never a fake inbox clone."
        actions={
          <Link href="/settings/connections">
            <CrmBtn variant="primary">Manage connections</CrmBtn>
          </Link>
        }
      />

      {connections.isLoading ? (
        <CrmEmpty title="Loading seams…" />
      ) : (
        <div className="crm-cards">
          {cards.map((card) => {
            const row = byToolkit.get(card.key);
            const status =
              card.key === "linkedin"
                ? "Draft only"
                : row?.status === "connected"
                  ? "Connected"
                  : row?.status === "pending"
                    ? "Pending"
                    : "Disconnected";
            const kind =
              status === "Connected"
                ? "success"
                : status === "Draft only"
                  ? "info"
                  : status === "Pending"
                    ? "warn"
                    : "warn";
            return (
              <article key={card.key} className="crm-object-card">
                <div className="crm-object-top">
                  <span className="crm-company-logo">{card.mark}</span>
                  <CrmTag kind={kind}>{status}</CrmTag>
                </div>
                <h3>{card.title}</h3>
                <p>{card.copy}</p>
                <div className="crm-object-foot">
                  <span>
                    {row?.status
                      ? `Status: ${row.status}`
                      : "No data requested"}
                  </span>
                  {card.key === "linkedin" ? (
                    <span className="text-[var(--ochre-dark)]">
                      {card.action} →
                    </span>
                  ) : row?.status === "connected" ? (
                    <Link
                      href="/settings/connections"
                      className="text-[var(--ochre-dark)]"
                    >
                      {card.action} →
                    </Link>
                  ) : (
                    <Link
                      href="/settings/connections"
                      className="text-[var(--ochre-dark)]"
                    >
                      Connect →
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
          <article className="crm-object-card">
            <div className="crm-object-top">
              <span className="crm-company-logo">＋</span>
              <CrmTag kind="warn">Disconnected</CrmTag>
            </div>
            <h3>Another calendar</h3>
            <p>
              Connect a supported workspace calendar when your team is ready.
            </p>
            <div className="crm-object-foot">
              <span>No data requested</span>
              <Link
                href="/settings/connections"
                className="text-[var(--ochre-dark)]"
              >
                Connect →
              </Link>
            </div>
          </article>
        </div>
      )}
    </main>
  );
}
