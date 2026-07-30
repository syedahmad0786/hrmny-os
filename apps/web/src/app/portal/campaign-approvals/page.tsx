"use client";

import { useState } from "react";
import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";

type PortalItem = {
  campaignItemId: string;
  title: string;
  channel: string;
  scheduledFor: string | null;
  state: string;
};

/** Portal campaign approvals — clients approve or request changes to campaign
 * items here, and hold a consolidated proofing thread per item. Approve/reject
 * route through the portal_item gate (portal_client only); a rejection requires
 * a feedback body, recorded as the first comment on the thread. */
export default function PortalCampaignApprovalsPage() {
  const utils = trpc.useUtils();
  const list = trpc.portal.campaignApprovals.list.useQuery();
  const approve = trpc.portal.campaignApprovals.approve.useMutation({
    onSuccess: () => void utils.portal.campaignApprovals.list.invalidate(),
  });
  const items = (list.data ?? []) as PortalItem[];

  return (
    <main className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold text-ink">
        Campaign approvals
      </h1>
      <p className="text-muted">
        Approve or request changes to campaign content for your account before
        it is published.
      </p>
      <ul className="space-y-6">
        {items.map((item) => (
          <ApprovalRow
            key={item.campaignItemId}
            item={item}
            onApprove={() => approve.mutate({ id: item.campaignItemId })}
          />
        ))}
        {!items.length && (
          <li className="text-sm text-muted">No items awaiting approval</li>
        )}
      </ul>
    </main>
  );
}

function ApprovalRow({
  item,
  onApprove,
}: {
  item: PortalItem;
  onApprove: () => void;
}) {
  const utils = trpc.useUtils();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");

  const thread = trpc.portal.campaignApprovals.feedback.list.useQuery({
    campaignItemId: item.campaignItemId,
  });
  const invalidate = () => {
    void utils.portal.campaignApprovals.list.invalidate();
    void utils.portal.campaignApprovals.feedback.list.invalidate({
      campaignItemId: item.campaignItemId,
    });
  };
  const reject = trpc.portal.campaignApprovals.reject.useMutation({
    onSuccess: () => {
      setRejecting(false);
      setReason("");
      invalidate();
    },
  });
  const addComment = trpc.portal.campaignApprovals.feedback.add.useMutation({
    onSuccess: () => {
      setComment("");
      invalidate();
    },
  });
  const comments = thread.data ?? [];

  return (
    <li className="flex flex-col gap-3 border-b border-[#D9D0C4] pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-ink">{item.title}</p>
          <p className="text-sm text-muted">
            {item.channel} · {item.scheduledFor ?? "unscheduled"} ·{" "}
            {item.state.replace("_", " ")}
          </p>
        </div>
        {item.state === "pending_client" && !rejecting && (
          <div className="flex gap-2">
            <Button type="button" onClick={onApprove}>
              Approve
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRejecting(true)}
            >
              Request changes
            </Button>
          </div>
        )}
      </div>

      {rejecting && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reason.trim()) return;
            reject.mutate({ id: item.campaignItemId, feedback: reason.trim() });
          }}
        >
          <textarea
            className="min-h-24 rounded border border-sand bg-white px-3 py-2"
            placeholder="What needs to change? (required)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={!reason.trim() || reject.isPending}>
              Send request
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRejecting(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-2">
        {comments.map((c) => (
          <div key={c.id} className="text-sm">
            <span className="font-medium text-ink">
              {c.authorKind === "staff" ? "Agency" : "You"}
            </span>{" "}
            <span className="text-muted">{c.body}</span>
            {c.resolved && (
              <span className="ml-2 text-xs text-muted">(resolved)</span>
            )}
          </div>
        ))}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!comment.trim()) return;
            addComment.mutate({
              campaignItemId: item.campaignItemId,
              body: comment.trim(),
            });
          }}
        >
          <input
            className="flex-1 rounded border border-sand bg-white px-3 py-2 text-sm"
            placeholder="Add a comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <Button
            type="submit"
            variant="ghost"
            disabled={!comment.trim() || addComment.isPending}
          >
            Comment
          </Button>
        </form>
      </div>
    </li>
  );
}
