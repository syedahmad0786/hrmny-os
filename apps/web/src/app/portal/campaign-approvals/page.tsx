"use client";

import { useState } from "react";
import { Button } from "@hrmny/ui";

/**
 * Portal campaign approvals — clients approve/reject campaign items here.
 *
 * ─── WIRING POINT ───────────────────────────────────────────────────────────
 * The backend (apps/web/src/server/trpc/portal-approvals-router.ts) is built
 * but intentionally NOT yet registered in root.ts (orchestrator-owned). Until
 * it is wired as `portal.campaignApprovals` (or a top-level `portalApprovals`),
 * this page uses local placeholder rows so the route type-checks. Once the
 * orchestrator registers the router, replace the placeholder block below with:
 *
 *   const utils = trpc.useUtils();
 *   const list = trpc.portalApprovals.list.useQuery();
 *   const approve = trpc.portalApprovals.approve.useMutation({
 *     onSuccess: () => void utils.portalApprovals.list.invalidate(),
 *   });
 *   const reject = trpc.portalApprovals.reject.useMutation({
 *     onSuccess: () => void utils.portalApprovals.list.invalidate(),
 *   });
 *
 * and swap the button handlers to approve.mutate({ id }) / reject.mutate({ id }).
 * The row shape below matches PortalItemView from the repository exactly.
 * ────────────────────────────────────────────────────────────────────────────
 */

type PortalItemState = "pending_client" | "approved" | "rejected";

type PortalItemView = {
  campaignItemId: string;
  title: string;
  channel: string;
  state: PortalItemState;
  scheduledFor: string | null;
  feedback: string | null;
};

const PLACEHOLDER_ITEMS: PortalItemView[] = [
  {
    campaignItemId: "c9000000-0000-4000-8000-000000000001",
    title: "Ramadan teaser — carousel",
    channel: "linkedin",
    state: "pending_client",
    scheduledFor: "2026-08-03",
    feedback: null,
  },
  {
    campaignItemId: "c9000000-0000-4000-8000-000000000002",
    title: "Product launch reel",
    channel: "instagram",
    state: "pending_client",
    scheduledFor: "2026-08-07",
    feedback: null,
  },
];

export default function PortalCampaignApprovalsPage() {
  // Placeholder local state — replace with the trpc query/mutations above.
  const [items, setItems] = useState<PortalItemView[]>(PLACEHOLDER_ITEMS);
  const decide = (id: string, state: PortalItemState) =>
    setItems((prev) =>
      prev.map((it) => (it.campaignItemId === id ? { ...it, state } : it)),
    );

  return (
    <main className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold text-ink">
        Campaign approvals
      </h1>
      <p className="text-muted">
        Approve or request changes to campaign content for your account before
        it is published.
      </p>
      <ul className="space-y-4">
        {items.map((item) => (
          <li
            key={item.campaignItemId}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-[#D9D0C4] pb-4"
          >
            <div>
              <p className="font-medium text-ink">{item.title}</p>
              <p className="text-sm text-muted">
                {item.channel} · {item.scheduledFor ?? "unscheduled"} ·{" "}
                {item.state.replace("_", " ")}
              </p>
            </div>
            {item.state === "pending_client" && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => decide(item.campaignItemId, "approved")}
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => decide(item.campaignItemId, "rejected")}
                >
                  Request changes
                </Button>
              </div>
            )}
          </li>
        ))}
        {!items.length && (
          <li className="text-sm text-muted">No items awaiting approval</li>
        )}
      </ul>
    </main>
  );
}
