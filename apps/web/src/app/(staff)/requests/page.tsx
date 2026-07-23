"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { useMemo, useState } from "react";

type Prd = {
  problem: string;
  desiredOutcome: string;
  inScope: string[];
  outOfScope: string[];
  acceptanceCriteria: string[];
};

type Status =
  "draft" | "review" | "approved" | "rejected" | "building" | "shipped";

const NEXT_ACTION: Partial<
  Record<Status, Array<{ status: Status; label: string }>>
> = {
  draft: [{ status: "review", label: "Send for review" }],
  review: [
    { status: "approved", label: "Approve" },
    { status: "rejected", label: "Request changes" },
  ],
  approved: [{ status: "building", label: "Start building" }],
  rejected: [{ status: "draft", label: "Return to draft" }],
  building: [{ status: "shipped", label: "Mark shipped" }],
};

function toLines(value: string[]) {
  return value.join("\n");
}

function fromLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePrd(value: Record<string, unknown>): Prd {
  const strings = (candidate: unknown) =>
    Array.isArray(candidate)
      ? candidate.filter((item): item is string => typeof item === "string")
      : [];
  return {
    problem: typeof value.problem === "string" ? value.problem : "",
    desiredOutcome:
      typeof value.desiredOutcome === "string" ? value.desiredOutcome : "",
    inScope: strings(value.inScope),
    outOfScope: strings(value.outOfScope),
    acceptanceCriteria: strings(value.acceptanceCriteria),
  };
}

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function VoiceNote({ id }: { id: string }) {
  const voice = trpc.featureRequests.voiceUrl.useQuery({ id });
  if (!voice.data?.url) return null;
  return (
    <audio
      className="mt-3 h-9 max-w-full"
      controls
      preload="none"
      src={voice.data.url}
    >
      Your browser does not support audio playback.
    </audio>
  );
}

export default function RequestsPage() {
  const utils = trpc.useUtils();
  const requests = trpc.featureRequests.list.useQuery();
  const createRequest = trpc.featureRequests.create.useMutation({
    onSuccess: () => {
      setTitle("");
      setIdea("");
      setVoice(null);
      void utils.featureRequests.list.invalidate();
    },
  });
  const updatePrd = trpc.featureRequests.updatePrd.useMutation({
    onSuccess: () => {
      setEditing(null);
      setDraft(null);
      void utils.featureRequests.list.invalidate();
    },
  });
  const transition = trpc.featureRequests.transition.useMutation({
    onSuccess: () => void utils.featureRequests.list.invalidate(),
  });
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [voice, setVoice] = useState<File | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Prd | null>(null);

  const error = useMemo(
    () => createRequest.error ?? updatePrd.error ?? transition.error,
    [createRequest.error, transition.error, updatePrd.error],
  );

  async function submitRequest() {
    const encodedVoice = voice
      ? {
          fileName: voice.name,
          contentType: voice.type || "audio/webm",
          contentBase64: await fileToBase64(voice),
        }
      : undefined;
    createRequest.mutate({ title, idea, voice: encodedVoice });
  }

  return (
    <main className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">
          Product intake
        </p>
        <h1 className="font-display text-3xl font-semibold">
          Feature requests
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Dump an idea or attach a voice note. Harmony OS creates a structured,
          editable PRD that must be reviewed and approved before development.
        </p>
      </header>

      <section className="rounded-lg border border-sand bg-white/70 p-5">
        <h2 className="font-display text-xl font-semibold">New request</h2>
        <div className="mt-4 grid gap-3">
          <input
            className="rounded border border-sand bg-white px-3 py-2"
            placeholder="Short title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <textarea
            className="min-h-32 rounded border border-sand bg-white px-3 py-2"
            placeholder="Describe the problem, desired result, users, and constraints—or attach a voice note below."
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
          />
          <label className="text-sm text-muted">
            Optional voice note (audio, up to 5 MB)
            <input
              className="mt-1 block w-full rounded border border-sand bg-white px-3 py-2"
              type="file"
              accept="audio/*"
              capture
              onChange={(event) => setVoice(event.target.files?.[0] ?? null)}
            />
          </label>
          <div>
            <Button
              type="button"
              disabled={
                title.trim().length < 3 ||
                (idea.trim().length < 10 && !voice) ||
                Boolean(voice && voice.size > 5_000_000) ||
                createRequest.isPending
              }
              onClick={() => void submitRequest()}
            >
              {createRequest.isPending ? "Creating…" : "Create PRD draft"}
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4">
        {(requests.data ?? []).map((request) => {
          const requestPrd = parsePrd(request.prd);
          const isEditing = editing === request.featureRequestId && draft;
          const actions = NEXT_ACTION[request.status as Status] ?? [];
          return (
            <article
              key={request.featureRequestId}
              className="rounded-lg border border-sand bg-white/70 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <span className="rounded-full bg-sand px-2 py-1 text-[11px] font-bold uppercase tracking-wide">
                    {request.status}
                  </span>
                  <h2 className="mt-2 font-display text-xl font-semibold">
                    {request.title}
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    {new Date(request.createdAt).toLocaleString()}
                    {request.voiceStoragePath ? " · Voice note attached" : ""}
                  </p>
                  {request.voiceStoragePath ? (
                    <VoiceNote id={request.featureRequestId} />
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(request.status === "draft" ||
                    request.status === "rejected") && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setEditing(request.featureRequestId);
                        setDraft(requestPrd);
                      }}
                    >
                      Edit PRD
                    </Button>
                  )}
                  {actions.map((action) => (
                    <Button
                      key={action.status}
                      type="button"
                      variant={
                        action.status === "rejected" ? "ghost" : "primary"
                      }
                      disabled={transition.isPending}
                      onClick={() =>
                        transition.mutate({
                          id: request.featureRequestId,
                          status: action.status,
                        })
                      }
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              </div>

              {isEditing ? (
                <div className="mt-5 grid gap-3">
                  <label className="text-sm font-medium">
                    Problem
                    <textarea
                      className="mt-1 min-h-24 w-full rounded border border-sand bg-white px-3 py-2 font-normal"
                      value={draft.problem}
                      onChange={(event) =>
                        setDraft({ ...draft, problem: event.target.value })
                      }
                    />
                  </label>
                  <label className="text-sm font-medium">
                    Desired outcome
                    <textarea
                      className="mt-1 min-h-20 w-full rounded border border-sand bg-white px-3 py-2 font-normal"
                      value={draft.desiredOutcome}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          desiredOutcome: event.target.value,
                        })
                      }
                    />
                  </label>
                  {(
                    [
                      ["inScope", "In scope"],
                      ["outOfScope", "Out of scope"],
                      ["acceptanceCriteria", "Acceptance criteria"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="text-sm font-medium">
                      {label} (one per line)
                      <textarea
                        className="mt-1 min-h-20 w-full rounded border border-sand bg-white px-3 py-2 font-normal"
                        value={toLines(draft[key])}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            [key]: fromLines(event.target.value),
                          })
                        }
                      />
                    </label>
                  ))}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      disabled={updatePrd.isPending}
                      onClick={() =>
                        updatePrd.mutate({
                          id: request.featureRequestId,
                          prd: draft,
                        })
                      }
                    >
                      Save PRD
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setEditing(null);
                        setDraft(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <dl className="mt-5 grid gap-4 text-sm lg:grid-cols-2">
                  <div>
                    <dt className="font-semibold">Problem</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-muted">
                      {requestPrd.problem}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Desired outcome</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-muted">
                      {requestPrd.desiredOutcome}
                    </dd>
                  </div>
                  {(
                    [
                      ["inScope", "In scope"],
                      ["outOfScope", "Out of scope"],
                      ["acceptanceCriteria", "Acceptance criteria"],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key}>
                      <dt className="font-semibold">{label}</dt>
                      <dd className="mt-1 text-muted">
                        <ul className="list-disc space-y-1 pl-5">
                          {requestPrd[key].map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </article>
          );
        })}
        {requests.isLoading ? (
          <p className="text-sm text-muted">Loading requests…</p>
        ) : null}
        {!requests.isLoading && (requests.data ?? []).length === 0 ? (
          <p className="rounded-lg border border-dashed border-sand p-8 text-center text-sm text-muted">
            No feature requests yet.
          </p>
        ) : null}
      </section>

      {error ? <p className="text-sm text-red-700">{error.message}</p> : null}
    </main>
  );
}
