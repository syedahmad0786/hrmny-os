"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";

/** Portal campaign approvals — clients approve/reject campaign items here.
 * Approve/reject route through the portal_item gate (portal_client only). */
export default function PortalCampaignApprovalsPage() {
  const utils = trpc.useUtils();
  const list = trpc.portal.campaignApprovals.list.useQuery();
  const approve = trpc.portal.campaignApprovals.approve.useMutation({
    onSuccess: () => void utils.portal.campaignApprovals.list.invalidate(),
  });
  const reject = trpc.portal.campaignApprovals.reject.useMutation({
    onSuccess: () => void utils.portal.campaignApprovals.list.invalidate(),
  });
  const items = list.data ?? [];
  const decide = (id: string, state: "approved" | "rejected") =>
    state === "approved" ? approve.mutate({ id }) : reject.mutate({ id });

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
