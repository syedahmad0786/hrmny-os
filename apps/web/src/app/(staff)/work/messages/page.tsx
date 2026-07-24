"use client";

import { useEffect, useState } from "react";
import { WorkLikeButton } from "@/components/work-like-button";
import { WorkNav } from "@/components/work-nav";
import {
  WorkRichText,
  WorkRichTextEditor,
  type WorkMentionOption,
} from "@/components/work-rich-text";
import { trpc } from "@/lib/trpc";

export default function WorkMessagesPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const projects = trpc.work.projects.list.useQuery();
  const employees = trpc.work.members.listEmployees.useQuery();
  const teams = trpc.work.messages.teams.useQuery();
  const richTextEnabled =
    session.data?.enabledFeatureKeys.includes("work.rich_text") ?? false;
  const [scopeType, setScopeType] = useState<"project" | "team">("project");
  const [scopeId, setScopeId] = useState("");
  useEffect(() => {
    const options =
      scopeType === "project" ? (projects.data ?? []) : (teams.data ?? []);
    if (
      !options.some(
        (option) =>
          ("projectId" in option ? option.projectId : option.teamId) ===
          scopeId,
      )
    )
      setScopeId(
        options[0]
          ? "projectId" in options[0]
            ? options[0].projectId
            : options[0].teamId
          : "",
      );
  }, [projects.data, scopeId, scopeType, teams.data]);

  const scope =
    scopeType === "project" ? { projectId: scopeId } : { teamId: scopeId };
  const messages = trpc.work.messages.list.useQuery(scope, {
    enabled: Boolean(scopeId),
  });
  const [selectedMessageId, setSelectedMessageId] = useState("");
  useEffect(() => {
    if (
      !messages.data?.some((message) => message.messageId === selectedMessageId)
    )
      setSelectedMessageId(messages.data?.[0]?.messageId ?? "");
  }, [messages.data, selectedMessageId]);
  const comments = trpc.work.messages.comments.useQuery(
    { messageId: selectedMessageId },
    { enabled: Boolean(selectedMessageId) },
  );

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [announcement, setAnnouncement] = useState(false);
  const create = trpc.work.messages.create.useMutation({
    onSuccess: async (message) => {
      setSubject("");
      setBody("");
      setAnnouncement(false);
      setSelectedMessageId(message.messageId);
      await utils.work.messages.list.invalidate();
    },
  });
  const [reply, setReply] = useState("");
  const comment = trpc.work.messages.comment.useMutation({
    onSuccess: async () => {
      setReply("");
      await Promise.all([
        utils.work.messages.comments.invalidate(),
        utils.work.messages.list.invalidate(),
      ]);
    },
  });
  const follow = trpc.work.messages.setFollowing.useMutation({
    onSuccess: () => utils.work.messages.list.invalidate(),
  });
  const selected = messages.data?.find(
    (message) => message.messageId === selectedMessageId,
  );
  const currentProject = projects.data?.find(
    (project) => project.projectId === scopeId,
  );
  const currentTeam = teams.data?.find((team) => team.teamId === scopeId);
  const canPost =
    scopeType === "project"
      ? ["admin", "editor", "commenter"].includes(
          currentProject?.accessLevel ?? "viewer",
        )
      : Boolean(currentTeam?.canPost);
  const canComment =
    scopeType === "project"
      ? canPost
      : currentTeam?.role === "admin" || currentTeam?.role === "member";
  const mentionOptions: WorkMentionOption[] = [
    ...(employees.data ?? []).map((employee) => ({
      id: employee.employeeId,
      label: employee.displayName,
      type: "person" as const,
    })),
    ...(projects.data ?? []).map((project) => ({
      id: project.projectId,
      label: project.name,
      type: "project" as const,
    })),
    ...(teams.data ?? []).map((team) => ({
      id: team.teamId,
      label: team.name,
      type: "team" as const,
    })),
    ...(messages.data ?? []).map((message) => ({
      id: message.messageId,
      label: message.subject,
      type: "message" as const,
    })),
  ];

  return (
    <main className="flex flex-col gap-5">
      <WorkNav />
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
          Conversations
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold">Messages</h1>
        <p className="mt-2 text-sm text-muted">
          Project announcements and team conversations outside individual tasks.
        </p>
      </header>

      <section className="grid gap-3 rounded-xl border border-sand bg-white/70 p-4 md:grid-cols-2">
        <label className="text-sm">
          Message space
          <select
            className="mt-1 w-full rounded border border-sand bg-white px-3 py-2"
            value={scopeType}
            onChange={(event) => {
              setScopeType(event.target.value as "project" | "team");
              setScopeId("");
            }}
          >
            <option value="project">Project</option>
            <option value="team">Team</option>
          </select>
        </label>
        <label className="text-sm">
          {scopeType === "project" ? "Project" : "Team"}
          <select
            className="mt-1 w-full rounded border border-sand bg-white px-3 py-2"
            value={scopeId}
            onChange={(event) => setScopeId(event.target.value)}
          >
            {(scopeType === "project"
              ? (projects.data ?? [])
              : (teams.data ?? [])
            ).map((option) => {
              const id =
                "projectId" in option ? option.projectId : option.teamId;
              return (
                <option key={id} value={id}>
                  {option.name}
                </option>
              );
            })}
          </select>
        </label>
      </section>

      {scopeId && canPost ? (
        <form
          className="grid gap-3 rounded-xl border border-sand bg-white/70 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({
              ...scope,
              subject,
              body,
              isAnnouncement: announcement,
            });
          }}
        >
          <h2 className="font-display text-xl">New message</h2>
          <input
            aria-label="Message subject"
            className="rounded border border-sand px-3 py-2"
            placeholder="Subject"
            maxLength={300}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
          {richTextEnabled ? (
            <WorkRichTextEditor
              ariaLabel="Message body"
              maxLength={50_000}
              mentions={mentionOptions}
              placeholder="Share an update…"
              value={body}
              onChange={setBody}
            />
          ) : (
            <textarea
              aria-label="Message body"
              className="min-h-28 rounded border border-sand px-3 py-2"
              placeholder="Share an update…"
              maxLength={50_000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={announcement}
                onChange={(event) => setAnnouncement(event.target.checked)}
              />
              Announcement
            </label>
            <button
              className="rounded bg-ink px-4 py-2 text-sm text-white"
              disabled={!subject.trim() || create.isPending}
            >
              Send
            </button>
          </div>
        </form>
      ) : scopeId ? (
        <p className="rounded-xl border border-sand bg-white/70 p-4 text-sm text-muted">
          You can read this space, but its send policy does not allow you to
          post.
        </p>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="space-y-2">
          {(messages.data ?? []).map((message) => (
            <button
              key={message.messageId}
              type="button"
              className={`w-full rounded-xl border p-4 text-left ${selectedMessageId === message.messageId ? "border-ink bg-white" : "border-sand bg-white/70"}`}
              onClick={() => setSelectedMessageId(message.messageId)}
            >
              <p className="text-xs font-bold uppercase tracking-wide text-ochre">
                {message.isAnnouncement ? "Announcement" : "Message"}
              </p>
              <h3 className="mt-1 font-medium">{message.subject}</h3>
              {richTextEnabled ? (
                <WorkRichText
                  className="mt-2 line-clamp-2 text-sm text-muted"
                  value={message.body}
                />
              ) : (
                <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-muted">
                  {message.body}
                </p>
              )}
              <p className="mt-2 text-xs text-muted">
                {message.authorName} · {message.commentCount} replies ·{" "}
                {message.likeCount} likes
              </p>
            </button>
          ))}
          {!messages.isLoading && !messages.data?.length ? (
            <p className="rounded-xl border border-sand bg-white/70 p-6 text-center text-sm text-muted">
              No messages yet.
            </p>
          ) : null}
        </div>

        {selected ? (
          <article className="rounded-xl border border-sand bg-white/80 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl">{selected.subject}</h2>
                <p className="mt-1 text-xs text-muted">
                  {selected.authorName} ·{" "}
                  {new Date(selected.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2 text-xs">
                <WorkLikeButton
                  targetType="message"
                  targetId={selected.messageId}
                  onChanged={() => utils.work.messages.list.invalidate()}
                />
                <button
                  className="rounded-full border border-sand px-3 py-1"
                  onClick={() =>
                    follow.mutate({
                      messageId: selected.messageId,
                      following: !selected.following,
                    })
                  }
                >
                  {selected.following ? "Following" : "Follow"}
                </button>
              </div>
            </div>
            {richTextEnabled ? (
              <WorkRichText className="mt-5 text-sm" value={selected.body} />
            ) : (
              <p className="mt-5 whitespace-pre-wrap text-sm">
                {selected.body}
              </p>
            )}
            <div className="mt-6 space-y-3 border-t border-sand pt-4">
              {(comments.data ?? []).map((entry) => (
                <div
                  key={entry.messageCommentId}
                  className="rounded-lg bg-canvas p-3"
                >
                  {richTextEnabled ? (
                    <WorkRichText className="text-sm" value={entry.body} />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm">{entry.body}</p>
                  )}
                  <div className="mt-2 flex items-center justify-between text-xs text-muted">
                    <span>
                      {entry.authorName} ·{" "}
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                    <WorkLikeButton
                      targetType="message_comment"
                      targetId={entry.messageCommentId}
                      onChanged={() =>
                        utils.work.messages.comments.invalidate()
                      }
                    />
                  </div>
                </div>
              ))}
              {canComment ? (
                <form
                  className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"
                  onSubmit={(event) => {
                    event.preventDefault();
                    comment.mutate({
                      messageId: selected.messageId,
                      body: reply,
                    });
                  }}
                >
                  {richTextEnabled ? (
                    <WorkRichTextEditor
                      ariaLabel="Reply"
                      maxLength={20_000}
                      mentions={mentionOptions}
                      placeholder="Reply…"
                      value={reply}
                      onChange={setReply}
                    />
                  ) : (
                    <input
                      aria-label="Reply"
                      className="min-w-0 flex-1 rounded border border-sand px-3 py-2 text-sm"
                      placeholder="Reply…"
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                    />
                  )}
                  <button
                    className="rounded bg-ink px-3 py-2 text-sm text-white"
                    disabled={!reply.trim()}
                  >
                    Reply
                  </button>
                </form>
              ) : null}
            </div>
          </article>
        ) : null}
      </section>

      {messages.error || comments.error || create.error || comment.error ? (
        <p role="alert" className="text-sm text-red-700">
          {
            (messages.error ?? comments.error ?? create.error ?? comment.error)
              ?.message
          }
        </p>
      ) : null}
    </main>
  );
}
