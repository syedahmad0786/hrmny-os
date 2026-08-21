"use client";

import { useState } from "react";
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
          <ApprovalRow
            key={item.approvalId}
            item={item}
            onApprove={() =>
              act.mutate({ id: item.approvalId, action: "approve" })
            }
            onReject={(feedback) =>
              act.mutate({
                id: item.approvalId,
                action: "reject",
                feedback,
              })
            }
            pending={act.isPending}
          />
        ))}
        {!list.data?.length && (
          <li className="text-sm text-muted">No approvals queued</li>
        )}
      </ul>
    </main>
  );
}

function ApprovalRow({
  item,
  onApprove,
  onReject,
  pending,
}: {
  item: {
    approvalId: string;
    title: string;
    kind: string;
    slaHours: number;
    status: string;
  };
  onApprove: () => void;
  onReject: (feedback: string) => void;
  pending: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <li className="flex flex-col gap-3 border-b border-[#D9D0C4] pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-ink">{item.title}</p>
          <p className="text-sm text-muted">
            {item.kind} · SLA {item.slaHours}h · {item.status}
          </p>
        </div>
        {item.status === "pending" && !rejecting && (
          <div className="flex gap-2">
            <Button type="button" onClick={onApprove} disabled={pending}>
              Approve
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRejecting(true)}
              disabled={pending}
            >
              Request changes
            </Button>
          </div>
        )}
      </div>

      {item.status === "pending" && rejecting && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reason.trim()) return;
            onReject(reason.trim());
            setRejecting(false);
            setReason("");
          }}
        >
          <textarea
            className="min-h-24 rounded border border-[#D9D0C4] bg-white px-3 py-2 text-ink"
            placeholder="What needs to change? (required)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={!reason.trim() || pending}>
              Send request
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setRejecting(false);
                setReason("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}
