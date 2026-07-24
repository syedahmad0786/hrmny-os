"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { WorkNav } from "@/components/work-nav";
import { trpc } from "@/lib/trpc";

const triggers = [
  ["manual", "Run manually"],
  ["task_added", "Task added"],
  ["task_completed", "Task completed"],
  ["task_moved", "Task moved"],
  ["priority_changed", "Priority changed"],
  ["due_date_set", "Due date set"],
  ["approval_decided", "Approval decided"],
  ["scheduled", "On a schedule"],
] as const;
const actionTypes = [
  ["create_task", "Create task"],
  ["update_task", "Update task"],
  ["create_comment", "Add comment"],
  ["create_status", "Create status update"],
  ["create_goal", "Create goal"],
  ["create_custom_field", "Create custom field"],
  ["create_rule", "Create rule"],
  ["create_project", "Create project"],
  ["delete_task", "Archive task"],
  ["create_subtask", "Create subtask"],
  ["set_custom_field", "Update custom field"],
  ["add_to_project", "Add task to project"],
  ["add_follower", "Add collaborator"],
  ["remove_follower", "Remove collaborator"],
  ["create_section", "Create section"],
  ["update_section", "Update section"],
  ["bulk_update_tasks", "Bulk update tasks"],
  ["add_dependency", "Create dependency"],
  ["create_milestone", "Create milestone"],
  ["attach_file", "Attach linked file"],
] as const;
type Trigger = (typeof triggers)[number][0];
type ActionType = (typeof actionTypes)[number][0];
const card = "rounded-xl border border-sand bg-white/80 p-5";
const input = "w-full rounded-lg border border-sand bg-white px-3 py-2";

export default function WorkAiStudioPage() {
  const projects = trpc.work.projects.list.useQuery();
  const workflows = trpc.workAiStudio.list.useQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<Trigger>("manual");
  const [aiCondition, setAiCondition] = useState("");
  const [instructions, setInstructions] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [allowedActionTypes, setAllowedActionTypes] = useState<ActionType[]>([
    "create_comment",
  ]);
  const [model, setModel] = useState("");
  const [scheduleMinutes, setScheduleMinutes] = useState(1_440);
  const [words, setWords] = useState("");
  const [itemId, setItemId] = useState("");

  const selected = workflows.data?.find(
    (workflow) => workflow.workflowId === selectedId,
  );

  useEffect(() => {
    if (!selected) return;
    setProjectId(selected.projectId);
    setName(selected.name);
    setDescription(selected.description);
    setTriggerType(selected.triggerType);
    setAiCondition(selected.aiCondition ?? "");
    setInstructions(selected.instructions);
    setReferenceText(selected.referenceText);
    setAllowedActionTypes(selected.allowedActionTypes);
    setModel(selected.model ?? "");
    setScheduleMinutes(selected.scheduleMinutes ?? 1_440);
  }, [selected]);

  const refresh = async () => {
    await workflows.refetch();
  };
  const create = trpc.workAiStudio.create.useMutation({
    onSuccess: async (workflow) => {
      setSelectedId(workflow.workflowId);
      await refresh();
    },
  });
  const update = trpc.workAiStudio.update.useMutation({ onSuccess: refresh });
  const setStatus = trpc.workAiStudio.setStatus.useMutation({
    onSuccess: refresh,
  });
  const archive = trpc.workAiStudio.archive.useMutation({
    onSuccess: async () => {
      setSelectedId(null);
      await refresh();
    },
  });
  const draft = trpc.workAiStudio.draft.useMutation({
    onSuccess: ({ draft: generated }) => {
      setName(generated.name);
      setDescription(generated.description);
      setTriggerType(generated.triggerType);
      setAiCondition(generated.aiCondition ?? "");
      setInstructions(generated.instructions);
      setAllowedActionTypes(generated.allowedActionTypes);
      setScheduleMinutes(generated.scheduleMinutes ?? 1_440);
    },
  });
  const run = trpc.workAiStudio.run.useMutation({ onSuccess: refresh });

  const workflowInput = () => ({
    projectId,
    name,
    description,
    triggerType,
    aiCondition: aiCondition.trim() || null,
    instructions,
    referenceText,
    allowedActionTypes,
    model: model.trim() || null,
    scheduleMinutes: triggerType === "scheduled" ? scheduleMinutes : null,
  });
  const error =
    create.error ??
    update.error ??
    setStatus.error ??
    archive.error ??
    draft.error ??
    run.error;

  function reset() {
    setSelectedId(null);
    setProjectId(projects.data?.[0]?.projectId ?? "");
    setName("");
    setDescription("");
    setTriggerType("manual");
    setAiCondition("");
    setInstructions("");
    setReferenceText("");
    setAllowedActionTypes(["create_comment"]);
    setModel("");
    setScheduleMinutes(1_440);
    setItemId("");
  }

  return (
    <main className="flex flex-col gap-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
              Work · AI Studio
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold">
              Smart workflows
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-muted">
              Combine Work triggers with an AI check and governed draft actions.
              Every change still waits for explicit human approval.
            </p>
          </div>
          <Link className="text-sm underline" href="/work/ai">
            Open AI proposals
          </Link>
        </div>
        <WorkNav />
      </header>

      <section className={card}>
        <h2 className="font-display text-xl font-semibold">
          Describe a workflow
        </h2>
        <p className="mt-1 text-sm text-muted">
          Start in plain language, then review every generated setting.
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <textarea
            className={`${input} min-h-24 flex-1`}
            value={words}
            maxLength={10_000}
            onChange={(event) => setWords(event.target.value)}
            placeholder="When a new request is added, check whether it has enough detail and draft a helpful comment."
          />
          <button
            type="button"
            className="self-end rounded-lg bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={draft.isPending || !words.trim()}
            onClick={() => draft.mutate({ requestText: words })}
          >
            {draft.isPending ? "Drafting…" : "Draft with AI"}
          </button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className={card}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold">Workflows</h2>
            <button type="button" className="text-sm underline" onClick={reset}>
              New
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {(workflows.data ?? []).map((workflow) => (
              <button
                type="button"
                key={workflow.workflowId}
                className={`w-full rounded-lg border p-3 text-left ${selectedId === workflow.workflowId ? "border-ochre bg-ochre/5" : "border-sand bg-white"}`}
                onClick={() => setSelectedId(workflow.workflowId)}
              >
                <span className="block truncate text-sm font-semibold">
                  {workflow.name}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {workflow.triggerType.replaceAll("_", " ")} ·{" "}
                  {workflow.status}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {workflow.runCount} runs ·{" "}
                  {workflow.tokenCount.toLocaleString()} tokens
                </span>
              </button>
            ))}
            {!workflows.data?.length ? (
              <p className="text-sm text-muted">No smart workflows yet.</p>
            ) : null}
          </div>
        </aside>

        <form
          className={card}
          onSubmit={(event) => {
            event.preventDefault();
            if (selectedId)
              update.mutate({
                workflowId: selectedId,
                workflow: workflowInput(),
              });
            else create.mutate(workflowInput());
          }}
        >
          <h2 className="font-display text-xl font-semibold">
            {selected ? "Edit workflow" : "New workflow"}
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Project</span>
              <select
                className={input}
                required
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">Choose a project</option>
                {(projects.data ?? []).map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Name</span>
              <input
                className={input}
                required
                maxLength={160}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="block text-sm md:col-span-2">
              <span className="mb-1 block font-medium">Description</span>
              <input
                className={input}
                maxLength={20_000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">When</span>
              <select
                className={input}
                value={triggerType}
                onChange={(event) =>
                  setTriggerType(event.target.value as Trigger)
                }
              >
                {triggers.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {triggerType === "scheduled" ? (
              <label className="block text-sm">
                <span className="mb-1 block font-medium">
                  Repeat every (minutes)
                </span>
                <input
                  className={input}
                  type="number"
                  min={5}
                  max={10_080}
                  value={scheduleMinutes}
                  onChange={(event) =>
                    setScheduleMinutes(Number(event.target.value))
                  }
                />
              </label>
            ) : null}
            <label className="block text-sm md:col-span-2">
              <span className="mb-1 block font-medium">
                Check if (optional AI condition)
              </span>
              <textarea
                className={`${input} min-h-20`}
                maxLength={10_000}
                value={aiCondition}
                onChange={(event) => setAiCondition(event.target.value)}
                placeholder="Only continue when the request has enough detail to act on."
              />
            </label>
            <label className="block text-sm md:col-span-2">
              <span className="mb-1 block font-medium">Guidance for AI</span>
              <textarea
                className={`${input} min-h-36`}
                required
                maxLength={20_000}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
              />
            </label>
            <label className="block text-sm md:col-span-2">
              <span className="mb-1 block font-medium">
                Reference material (optional)
              </span>
              <textarea
                className={`${input} min-h-28`}
                maxLength={50_000}
                value={referenceText}
                onChange={(event) => setReferenceText(event.target.value)}
                placeholder="Paste the policy, examples, or playbook this workflow should consult."
              />
            </label>
            <fieldset className="md:col-span-2">
              <legend className="text-sm font-medium">
                Actions AI may propose
              </legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {actionTypes.map(([value, label]) => (
                  <label
                    key={value}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={allowedActionTypes.includes(value)}
                      onChange={() =>
                        setAllowedActionTypes((current) =>
                          current.includes(value)
                            ? current.filter((item) => item !== value)
                            : [...current, value],
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-sm md:col-span-2">
              <span className="mb-1 block font-medium">
                Model override (optional)
              </span>
              <input
                className={input}
                maxLength={200}
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="Uses the organisation AI model when blank"
              />
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-lg bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={create.isPending || update.isPending}
            >
              {selectedId ? "Save workflow" : "Create draft"}
            </button>
            {selected ? (
              <>
                <button
                  type="button"
                  className="rounded-lg border border-sand bg-white px-4 py-2 text-sm"
                  disabled={setStatus.isPending}
                  onClick={() =>
                    setStatus.mutate({
                      workflowId: selected.workflowId,
                      status:
                        selected.status === "published"
                          ? "paused"
                          : "published",
                    })
                  }
                >
                  {selected.status === "published" ? "Pause" : "Publish"}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-sand bg-white px-4 py-2 text-sm"
                  disabled={run.isPending}
                  onClick={() =>
                    run.mutate({
                      workflowId: selected.workflowId,
                      itemId: itemId.trim() || null,
                    })
                  }
                >
                  {run.isPending ? "Running…" : "Test run"}
                </button>
                <button
                  type="button"
                  className="text-sm text-[var(--hrmny-danger)] underline"
                  disabled={archive.isPending}
                  onClick={() => {
                    if (window.confirm("Archive this workflow?"))
                      archive.mutate({ workflowId: selected.workflowId });
                  }}
                >
                  Archive
                </button>
              </>
            ) : null}
          </div>
          {selected ? (
            <label className="mt-4 block max-w-xl text-sm">
              <span className="mb-1 block font-medium">
                Task ID for a test run (optional)
              </span>
              <input
                className={input}
                value={itemId}
                onChange={(event) => setItemId(event.target.value)}
                placeholder="Task UUID"
              />
            </label>
          ) : null}
          {run.data?.run ? (
            <p className="mt-4 text-sm" role="status">
              Test completed with status {run.data.run.status}. Review its
              proposed changes in{" "}
              <Link className="underline" href="/work/ai">
                Work intelligence
              </Link>
              .
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-4 text-sm text-[var(--hrmny-danger)]">
              {error.message}
            </p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
