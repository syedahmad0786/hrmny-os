"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";

export default function PortalApprovalsPage() {
  const utils = trpc.useUtils();
  const list = trpc.portal.approvals.list.useQuery();
  const act = trpc.portal.approvals.act.useMutation({
    onSuccess: () => void utils.portal.approvals.list.invalidate(),
  });

  return (
    <main className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold text-ink">Approvals</h1>
      <p className="text-muted">Pending client approvals for your account only.</p>
      <ul className="space-y-4">
        {(list.data ?? []).map((item) => (
          <li
            key={item.approvalId}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-[#D9D0C4] pb-4"
          >
            <div>
              <p className="font-medium text-ink">{item.title}</p>
              <p className="text-sm text-muted">
                {item.kind} · SLA {item.slaHours}h · {item.status}
              </p>
            </div>
            {item.status === "pending" && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() =>
                    act.mutate({ id: item.approvalId, action: "approve" })
                  }
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    act.mutate({
                      id: item.approvalId,
                      action: "reject",
                      feedback: "Needs revision",
                    })
                  }
                >
                  Reject
                </Button>
              </div>
            )}
          </li>
        ))}
        {!list.data?.length && (
          <li className="text-sm text-muted">No approvals queued</li>
        )}
      </ul>
    </main>
  );
}
