"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  WorkRichText,
  WorkRichTextEditor,
  type WorkMentionOption,
} from "@/components/work-rich-text";

export default function PortalWorkPage() {
  const utils = trpc.useUtils();
  const session = trpc.portal.auth.session.useQuery();
  const projects = trpc.portal.work.projects.list.useQuery();
  const [projectId, setProjectId] = useState("");
  const [itemId, setItemId] = useState("");
  const [comment, setComment] = useState("");
  const detail = trpc.portal.work.projects.get.useQuery(
    { projectId },
    { enabled: Boolean(projectId) },
  );
  const commentsEnabled =
    session.data?.enabledFeatureKeys.includes("work.comments") ?? false;
  const richTextEnabled =
    session.data?.enabledFeatureKeys.includes("work.rich_text") ?? false;
  const comments = trpc.portal.work.comments.list.useQuery(
    { itemId },
    { enabled: Boolean(itemId) && commentsEnabled },
  );
  const createComment = trpc.portal.work.comments.create.useMutation({
    onSuccess: async () => {
      setComment("");
      await utils.portal.work.comments.list.invalidate({ itemId });
    },
  });

  useEffect(() => {
    if (!projectId && projects.data?.[0]) {
      setProjectId(projects.data[0].projectId);
    }
  }, [projectId, projects.data]);

  useEffect(() => {
    setItemId(detail.data?.items[0] ? String(detail.data.items[0].itemId) : "");
  }, [detail.data?.items, projectId]);

  const selectedProject = projects.data?.find(
    (project) => project.projectId === projectId,
  );
  const selectedItem = detail.data?.items.find(
    (item) => String(item.itemId) === itemId,
  );
  const mentionOptions: WorkMentionOption[] = [
    ...(projects.data ?? []).map((project) => ({
      id: project.projectId,
      label: project.name,
      type: "project" as const,
    })),
    ...(detail.data?.items ?? []).map((item) => ({
      id: String(item.itemId),
      label: String(item.title),
      type: "task" as const,
    })),
  ];

  return (
    <main className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
          Shared work
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold">
          Projects shared with you
        </h1>
        <p className="mt-2 text-sm text-muted">
          Guests only see projects explicitly shared by an administrator.
        </p>
      </header>

      {projects.data?.length ? (
        <label className="text-sm">
          <span className="mb-1 block font-medium">Project</span>
          <select
            className="w-full rounded-lg border border-[#D9D0C4] bg-white px-3 py-2"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            {projects.data.map((project) => (
              <option key={project.projectId} value={project.projectId}>
                {project.name} · {project.accessLevel}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="rounded-lg border border-[#D9D0C4] bg-white/70 p-4 text-sm text-muted">
          No work projects have been shared with this account.
        </p>
      )}

      {selectedProject ? (
        <section className="rounded-xl border border-[#D9D0C4] bg-white/75 p-5">
          <h2 className="font-display text-xl font-semibold">
            {selectedProject.name}
          </h2>
          {richTextEnabled && selectedProject.description ? (
            <WorkRichText
              className="mt-1 text-sm text-muted"
              value={selectedProject.description}
            />
          ) : (
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted">
              {selectedProject.description || "No project description"}
            </p>
          )}
          <div className="mt-5 grid gap-4 md:grid-cols-[1fr_1.1fr]">
            <div>
              <h3 className="text-sm font-semibold">Tasks</h3>
              <div className="mt-2 space-y-2">
                {(detail.data?.items ?? []).map((item) => (
                  <button
                    key={String(item.itemId)}
                    type="button"
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${itemId === String(item.itemId) ? "border-ochre bg-[#FFF7ED]" : "border-[#D9D0C4] bg-white"}`}
                    onClick={() => setItemId(String(item.itemId))}
                  >
                    <span className="font-medium">{String(item.title)}</span>
                    <span className="mt-1 block text-xs text-muted">
                      {item.completedAt
                        ? "Completed"
                        : String(item.priority ?? "Open")}
                    </span>
                  </button>
                ))}
                {!detail.data?.items.length ? (
                  <p className="text-sm text-muted">No visible tasks.</p>
                ) : null}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold">Conversation</h3>
              {selectedItem?.description ? (
                richTextEnabled ? (
                  <WorkRichText
                    className="mt-2 rounded-lg border border-[#D9D0C4] bg-white p-3 text-sm"
                    value={String(selectedItem.description)}
                  />
                ) : (
                  <p className="mt-2 whitespace-pre-wrap rounded-lg border border-[#D9D0C4] bg-white p-3 text-sm">
                    {String(selectedItem.description)}
                  </p>
                )
              ) : null}
              {!commentsEnabled ? (
                <p className="mt-2 text-sm text-muted">
                  Comments are not included for this portal.
                </p>
              ) : (
                <>
                  <div className="mt-2 space-y-2">
                    {(comments.data ?? []).map((entry) => (
                      <article
                        key={String(entry.commentId)}
                        className="rounded-lg border border-[#D9D0C4] bg-white p-3 text-sm"
                      >
                        <p className="font-medium">
                          {String(entry.authorName)}
                        </p>
                        {richTextEnabled ? (
                          <WorkRichText
                            className="mt-1 text-muted"
                            value={String(entry.body)}
                          />
                        ) : (
                          <p className="mt-1 whitespace-pre-wrap text-muted">
                            {String(entry.body)}
                          </p>
                        )}
                      </article>
                    ))}
                  </div>
                  {selectedProject.accessLevel === "commenter" && itemId ? (
                    <form
                      className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (comment.trim()) {
                          createComment.mutate({
                            itemId,
                            body: comment.trim(),
                          });
                        }
                      }}
                    >
                      {richTextEnabled ? (
                        <WorkRichTextEditor
                          ariaLabel="Comment"
                          maxLength={20_000}
                          mentions={mentionOptions}
                          placeholder="Add a comment"
                          value={comment}
                          onChange={setComment}
                        />
                      ) : (
                        <input
                          aria-label="Comment"
                          className="min-w-0 flex-1 rounded-lg border border-[#D9D0C4] bg-white px-3 py-2 text-sm"
                          value={comment}
                          onChange={(event) => setComment(event.target.value)}
                          placeholder="Add a comment"
                          maxLength={20_000}
                        />
                      )}
                      <button
                        type="submit"
                        className="rounded-lg bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
                        disabled={!comment.trim() || createComment.isPending}
                      >
                        Send
                      </button>
                    </form>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
