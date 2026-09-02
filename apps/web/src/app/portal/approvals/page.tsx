"use client";

import { useState } from "react";
import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { hasSyntheticMarker } from "@/lib/synthetic-records";

export default function PortalApprovalsPage() {
  const utils = trpc.useUtils();
  const list = trpc.portal.approvals.list.useQuery();
  const act = trpc.portal.approvals.act.useMutation({
    onSuccess: () => void utils.portal.approvals.list.invalidate(),
  });
  const items = (list.data ?? []).filter(
    (item) => !hasSyntheticMarker(item.title),
  );

  return (
    <main className="flex flex-col gap-6" data-testid="portal-approvals">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
          Your decisions
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-ink">
          Approvals
        </h1>
        <p className="mt-2 text-muted">
          Review what needs your decision. If something is not right, request
          changes and tell the team exactly what to fix.
        </p>
      </div>
      <ul className="space-y-4" data-testid="portal-approvals-list">
        {items.map((item) => (
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
        {!list.isLoading && items.length === 0 && (
          <li
            className="rounded-xl border border-[#D9D0C4] bg-white/70 p-5 text-sm text-muted"
            data-testid="portal-approvals-empty"
          >
            Nothing needs your approval right now.
          </li>
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
    <li
      className="flex flex-col gap-4 rounded-xl border border-[#D9D0C4] bg-white/70 p-5"
      data-testid={`portal-approval-${item.approvalId}`}
      data-approval-status={item.status}
      data-approval-title={item.title}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p
            className="font-medium text-ink"
            data-testid="portal-approval-title"
          >
            {item.title}
          </p>
          <p className="text-sm text-muted">
            <span className="capitalize">{item.kind.replaceAll("_", " ")}</span>
            {" · "}
            {item.status === "pending"
              ? `Decision requested within ${item.slaHours} hours`
              : item.status.replaceAll("_", " ")}
          </p>
        </div>
        {item.status === "pending" && !rejecting && (
          <div className="flex gap-2">
            <Button
              type="button"
              data-testid="portal-approval-approve"
              onClick={onApprove}
              disabled={pending}
            >
              Approve
            </Button>
            <Button
              type="button"
              variant="ghost"
              data-testid="portal-approval-reject"
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
          data-testid="portal-approval-reject-form"
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
            data-testid="portal-approval-reject-reason"
            placeholder="What needs to change? (required)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              data-testid="portal-approval-reject-send"
              disabled={!reason.trim() || pending}
            >
              Send request
            </Button>
            <Button
              type="button"
              variant="ghost"
              data-testid="portal-approval-reject-cancel"
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
