"use client";

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

type Attachment = {
  attachmentId: string;
  name: string;
  contentType: string | null;
};

type Employee = {
  employeeId: string;
  displayName: string;
  displayLabel: string;
};

export function WorkProofingDialog({
  attachment,
  employees,
  onClose,
  onOpenTask,
  onChanged,
}: {
  attachment: Attachment;
  employees: Employee[];
  onClose: () => void;
  onOpenTask: (itemId: string) => void;
  onChanged: () => void | Promise<void>;
}) {
  const utils = trpc.useUtils();
  const isPdf =
    attachment.contentType?.toLowerCase() === "application/pdf" ||
    /\.pdf$/i.test(attachment.name);
  const [previewUrl, setPreviewUrl] = useState("");
  const open = trpc.work.attachments.open.useMutation({
    onSuccess: (result) => setPreviewUrl(result.url),
  });
  useEffect(() => {
    open.mutate({ attachmentId: attachment.attachmentId });
    // The attachment ID is the complete preview identity.
    // attachment/page deps intentionally omitted — reload only when dialog opens
  }, [attachment.attachmentId]);

  const annotations = trpc.work.proofing.list.useQuery({
    attachmentId: attachment.attachmentId,
  });
  const [pageNumber, setPageNumber] = useState(1);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [feedback, setFeedback] = useState("");
  const [assigneeEmployeeId, setAssigneeEmployeeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const create = trpc.work.proofing.create.useMutation({
    onSuccess: async () => {
      setPosition(null);
      setFeedback("");
      setAssigneeEmployeeId("");
      setDueDate("");
      await Promise.all([utils.work.proofing.list.invalidate(), onChanged()]);
    },
  });
  const complete = trpc.work.tasks.complete.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.work.proofing.list.invalidate(), onChanged()]);
    },
  });
  const visibleAnnotations = useMemo(
    () =>
      (annotations.data ?? [])
        .map((annotation, index) => ({ annotation, number: index + 1 }))
        .filter(
          ({ annotation }) => !isPdf || annotation.pageNumber === pageNumber,
        ),
    [annotations.data, isPdf, pageNumber],
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-3"
      role="dialog"
      aria-modal="true"
      aria-label={`Proof ${attachment.name}`}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section className="grid max-h-[95vh] w-full max-w-6xl overflow-hidden rounded-2xl bg-[var(--paper)] shadow-2xl lg:grid-cols-[1fr_22rem]">
        <div className="min-h-0 overflow-auto bg-zinc-900 p-4">
          <header className="mb-3 flex flex-wrap items-center justify-between gap-3 text-white">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-zinc-300">
                Proofing
              </p>
              <h2 className="font-medium">{attachment.name}</h2>
            </div>
            {isPdf ? (
              <label className="text-sm">
                Page
                <input
                  className="ml-2 w-20 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-white"
                  type="number"
                  min={1}
                  value={pageNumber}
                  onChange={(event) => {
                    setPageNumber(Math.max(1, Number(event.target.value) || 1));
                    setPosition(null);
                  }}
                />
              </label>
            ) : null}
          </header>
          {previewUrl ? (
            <div
              className="relative mx-auto w-full max-w-4xl cursor-crosshair overflow-hidden bg-black"
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                setPosition({
                  x: (event.clientX - bounds.left) / bounds.width,
                  y: (event.clientY - bounds.top) / bounds.height,
                });
              }}
            >
              {isPdf ? (
                <iframe
                  key={`${previewUrl}:${pageNumber}`}
                  title={attachment.name}
                  className="pointer-events-none h-[70vh] w-full bg-white"
                  src={`${previewUrl}#page=${pageNumber}&toolbar=0`}
                />
              ) : (
                // native img: proofing needs exact pixel frame, not next/image
                <img
                  className="block h-auto w-full select-none"
                  src={previewUrl}
                  alt={attachment.name}
                  draggable={false}
                />
              )}
              {visibleAnnotations.map(({ annotation, number }) => (
                <button
                  key={annotation.annotationId}
                  type="button"
                  className={`absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-bold shadow ${annotation.completedAt ? "bg-emerald-600 text-white" : "bg-ochre text-white"}`}
                  style={{
                    left: `${annotation.xPosition * 100}%`,
                    top: `${annotation.yPosition * 100}%`,
                  }}
                  title={annotation.title}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenTask(annotation.itemId);
                  }}
                >
                  {number}
                </button>
              ))}
              {position ? (
                <span
                  className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border-2 border-white bg-blue-600"
                  style={{
                    left: `${position.x * 100}%`,
                    top: `${position.y * 100}%`,
                  }}
                />
              ) : null}
            </div>
          ) : (
            <p className="flex h-[60vh] items-center justify-center text-sm text-zinc-300">
              {open.isPending ? "Opening preview…" : "Preview unavailable"}
            </p>
          )}
        </div>

        <aside className="min-h-0 overflow-y-auto border-l border-sand p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-xl">Actionable feedback</h3>
            <button
              type="button"
              className="rounded-full border border-sand px-3 py-1 text-sm"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Click the preview to pin feedback and create a subtask.
          </p>

          {position ? (
            <form
              className="mt-4 grid gap-3 rounded-xl border border-sand bg-white p-3"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate({
                  attachmentId: attachment.attachmentId,
                  xPosition: position.x,
                  yPosition: position.y,
                  pageNumber: isPdf ? pageNumber : null,
                  feedback,
                  assigneeEmployeeId: assigneeEmployeeId || null,
                  dueAt: dueDate ? `${dueDate}T12:00:00.000Z` : null,
                });
              }}
            >
              <textarea
                autoFocus
                className="min-h-24 rounded border border-sand px-3 py-2 text-sm"
                placeholder="What needs to change?"
                maxLength={500}
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
              />
              <select
                aria-label="Assignee"
                className="rounded border border-sand px-3 py-2 text-sm"
                value={assigneeEmployeeId}
                onChange={(event) => setAssigneeEmployeeId(event.target.value)}
              >
                <option value="">Unassigned</option>
                {employees.map((employee) => (
                  <option key={employee.employeeId} value={employee.employeeId}>
                    {employee.displayLabel}
                  </option>
                ))}
              </select>
              <input
                aria-label="Due date"
                className="rounded border border-sand px-3 py-2 text-sm"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded border border-sand px-3 py-2 text-sm"
                  onClick={() => setPosition(null)}
                >
                  Cancel
                </button>
                <button
                  className="rounded bg-ochre px-3 py-2 text-sm text-white"
                  disabled={!feedback.trim() || create.isPending}
                >
                  Create subtask
                </button>
              </div>
            </form>
          ) : null}

          <div className="mt-4 space-y-2">
            {(annotations.data ?? []).map((annotation, index) => (
              <article
                key={annotation.annotationId}
                className="rounded-lg border border-sand bg-white p-3"
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Complete ${annotation.title}`}
                    checked={Boolean(annotation.completedAt)}
                    onChange={(event) =>
                      complete.mutate({
                        itemId: annotation.itemId,
                        completed: event.target.checked,
                      })
                    }
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onOpenTask(annotation.itemId)}
                  >
                    <strong className="text-sm">
                      {index + 1}. {annotation.title}
                    </strong>
                    <span className="mt-1 block text-xs text-muted">
                      {annotation.pageNumber
                        ? `Page ${annotation.pageNumber} · `
                        : ""}
                      {employees.find(
                        (employee) =>
                          employee.employeeId === annotation.assigneeEmployeeId,
                      )?.displayLabel ??
                        annotation.assigneeName ??
                        "Unassigned"}
                      {annotation.dueAt
                        ? ` · Due ${annotation.dueAt.slice(0, 10)}`
                        : ""}
                    </span>
                  </button>
                </div>
              </article>
            ))}
            {!annotations.isLoading && !annotations.data?.length ? (
              <p className="rounded-lg bg-canvas p-4 text-center text-sm text-muted">
                No feedback pins yet.
              </p>
            ) : null}
          </div>
          {open.error || annotations.error || create.error || complete.error ? (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {
                (
                  open.error ??
                  annotations.error ??
                  create.error ??
                  complete.error
                )?.message
              }
            </p>
          ) : null}
        </aside>
      </section>
    </div>
  );
}
