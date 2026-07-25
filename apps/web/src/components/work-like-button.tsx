"use client";

import { trpc } from "@/lib/trpc";

type TargetType =
  | "item"
  | "comment"
  | "attachment"
  | "status_update"
  | "message"
  | "message_comment";

export function WorkLikeButton({
  targetType,
  targetId,
  onChanged,
}: {
  targetType: TargetType;
  targetId: string;
  onChanged?: () => void | Promise<void>;
}) {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const enabled = Boolean(
    session.data?.enabledFeatureKeys.includes("work.likes"),
  );
  const input = { targetType, targetId } as const;
  const summary = trpc.work.likes.summary.useQuery(input, { enabled });
  const setLike = trpc.work.likes.set.useMutation({
    onSuccess: async () => {
      await utils.work.likes.summary.invalidate(input);
      await onChanged?.();
    },
  });

  if (!enabled) return null;
  const names = summary.data?.people
    .map((person) => person.displayName)
    .join(", ");
  return (
    <button
      type="button"
      className="rounded-full border border-sand px-2.5 py-1 text-xs text-muted"
      aria-pressed={summary.data?.likedByMe ?? false}
      aria-label={`${summary.data?.likedByMe ? "Unlike" : "Like"} this item`}
      title={names || undefined}
      disabled={!summary.data || setLike.isPending}
      onClick={() =>
        setLike.mutate({
          ...input,
          liked: !summary.data!.likedByMe,
        })
      }
    >
      {summary.data?.likedByMe ? "♥ Liked" : "♡ Like"} ·{" "}
      {summary.data?.count ?? 0}
    </button>
  );
}
