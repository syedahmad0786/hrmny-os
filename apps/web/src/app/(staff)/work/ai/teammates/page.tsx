"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { WorkNav } from "@/components/work-nav";
import { trpc } from "@/lib/trpc";

const ZERO = "00000000-0000-0000-0000-000000000000";
const actionTypes = [
  ["create_task", "Create tasks"],
  ["update_task", "Update tasks"],
  ["create_comment", "Post comments"],
  ["create_project", "Create public projects"],
] as const;
type ActionType = (typeof actionTypes)[number][0];
const card = "rounded-xl border border-sand bg-white/80 p-5";
const input = "w-full rounded-lg border border-sand bg-white px-3 py-2";

export default function WorkAiTeammatesPage() {
  const session = trpc.auth.session.useQuery();
  const teammates = trpc.workAiTeammates.list.useQuery();
  const directory = trpc.workAiTeammates.directory.useQuery();
  const projects = trpc.work.projects.list.useQuery();
  const enabled = useMemo(
    () => new Set(session.data?.enabledFeatureKeys ?? []),
    [session.data?.enabledFeatureKeys],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = teammates.data?.find(
    (teammate) => teammate.teammateId === selectedId,
  );
  const teammateId = selectedId ?? ZERO;
  const members = trpc.workAiTeammates.members.list.useQuery(
    { teammateId },
    { enabled: Boolean(selectedId) },
  );
  const projectAccess = trpc.workAiTeammates.projects.list.useQuery(
    { teammateId },
    { enabled: Boolean(selectedId) },
  );
  const skills = trpc.workAiTeammates.skills.list.useQuery(
    { teammateId },
    { enabled: Boolean(selectedId) && enabled.has("work.ai.teammate_skills") },
  );
  const memories = trpc.workAiTeammates.memory.list.useQuery(
    { teammateId },
    { enabled: Boolean(selectedId) && enabled.has("work.ai.teammate_memory") },
  );

  const [name, setName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [allowedActionTypes, setAllowedActionTypes] = useState<ActionType[]>([
    "create_comment",
  ]);
  const [model, setModel] = useState("");
  const [shareEmployeeId, setShareEmployeeId] = useState("");
  const [memberLevel, setMemberLevel] = useState<"owner" | "editor" | "user">(
    "user",
  );
  const [accessProjectId, setAccessProjectId] = useState("");
  const [accessLevel, setAccessLevel] = useState<
    "editor" | "commenter" | "viewer"
  >("viewer");
  const [skillName, setSkillName] = useState("");
  const [skillGuidance, setSkillGuidance] = useState("");
  const [skillTrigger, setSkillTrigger] = useState("");
  const [skillReference, setSkillReference] = useState("");
  const [runProjectId, setRunProjectId] = useState("");
  const [runItemId, setRunItemId] = useState("");
  const [requestText, setRequestText] = useState("");
  const runProject = trpc.work.projects.get.useQuery(
    { projectId: runProjectId || ZERO },
    { enabled: Boolean(runProjectId) },
  );
  const canEdit = !selected || selected.memberAccess !== "user";
  const canOwn = selected?.memberAccess === "owner";

  useEffect(() => {
    if (!selected) return;
    setName(selected.name);
    setRoleDescription(selected.roleDescription);
    setInstructions(selected.instructions);
    setAllowedActionTypes(selected.allowedActionTypes);
    setModel(selected.model ?? "");
  }, [selected]);

  const refresh = async () => {
    await teammates.refetch();
  };
  const refreshAccess = async () => {
    await Promise.all([members.refetch(), projectAccess.refetch()]);
  };
  const create = trpc.workAiTeammates.create.useMutation({
    onSuccess: async (teammate) => {
      setSelectedId(teammate.teammateId);
      await refresh();
    },
  });
  const update = trpc.workAiTeammates.update.useMutation({
    onSuccess: refresh,
  });
  const setStatus = trpc.workAiTeammates.setStatus.useMutation({
    onSuccess: refresh,
  });
  const archive = trpc.workAiTeammates.archive.useMutation({
    onSuccess: async () => {
      setSelectedId(null);
      await refresh();
    },
  });
  const setMember = trpc.workAiTeammates.members.set.useMutation({
    onSuccess: refreshAccess,
  });
  const removeMember = trpc.workAiTeammates.members.remove.useMutation({
    onSuccess: refreshAccess,
  });
  const setProject = trpc.workAiTeammates.projects.set.useMutation({
    onSuccess: refreshAccess,
  });
  const removeProject = trpc.workAiTeammates.projects.remove.useMutation({
    onSuccess: refreshAccess,
  });
  const saveSkill = trpc.workAiTeammates.skills.save.useMutation({
    onSuccess: async () => {
      setSkillName("");
      setSkillGuidance("");
      setSkillTrigger("");
      setSkillReference("");
      await skills.refetch();
    },
  });
  const deleteSkill = trpc.workAiTeammates.skills.delete.useMutation({
    onSuccess: () => skills.refetch(),
  });
  const forgetMemory = trpc.workAiTeammates.memory.forget.useMutation({
    onSuccess: () => memories.refetch(),
  });
  const run = trpc.workAiTeammates.run.useMutation();

  const teammateInput = () => ({
    name,
    roleDescription,
    instructions,
    allowedActionTypes,
    model: model.trim() || null,
  });
  const error =
    create.error ??
    update.error ??
    setStatus.error ??
    archive.error ??
    setMember.error ??
    removeMember.error ??
    setProject.error ??
    removeProject.error ??
    saveSkill.error ??
    deleteSkill.error ??
    forgetMemory.error ??
    run.error;

  function reset() {
    setSelectedId(null);
    setName("");
    setRoleDescription("");
    setInstructions("");
    setAllowedActionTypes(["create_comment"]);
    setModel("");
  }

  return (
    <main className="flex flex-col gap-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
              Work · AI Teammates
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold">
              Collaborative AI teammates
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-muted">
              Share a governed teammate, grant it project access like a person,
              and trigger it by assignment, @mention, or a direct request.
            </p>
          </div>
          <Link className="text-sm underline" href="/work/ai">
            Open AI proposals
          </Link>
        </div>
        <WorkNav />
      </header>

      <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className={card}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold">Teammates</h2>
            <button type="button" className="text-sm underline" onClick={reset}>
              New
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {(teammates.data ?? []).map((teammate) => (
              <button
                key={teammate.teammateId}
                type="button"
                className={`w-full rounded-lg border p-3 text-left ${selectedId === teammate.teammateId ? "border-ochre bg-ochre/5" : "border-sand bg-white"}`}
                onClick={() => setSelectedId(teammate.teammateId)}
              >
                <span className="block truncate text-sm font-semibold">
                  {teammate.name}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {teammate.status} · {teammate.memberAccess}
                </span>
              </button>
            ))}
            {!teammates.data?.length ? (
              <p className="text-sm text-muted">No AI teammates yet.</p>
            ) : null}
          </div>
        </aside>

        <div className="space-y-5">
          <form
            className={card}
            onSubmit={(event) => {
              event.preventDefault();
              if (selectedId)
                update.mutate({
                  teammateId: selectedId,
                  teammate: teammateInput(),
                });
              else create.mutate(teammateInput());
            }}
          >
            <h2 className="font-display text-xl font-semibold">
              {selected ? "Teammate profile" : "Create teammate"}
            </h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Name</span>
                <input
                  className={input}
                  disabled={!canEdit}
                  required
                  maxLength={160}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Model override</span>
                <input
                  className={input}
                  disabled={!canEdit}
                  maxLength={200}
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="Organisation default"
                />
              </label>
              <label className="block text-sm md:col-span-2">
                <span className="mb-1 block font-medium">Role</span>
                <textarea
                  className={`${input} min-h-20`}
                  disabled={!canEdit}
                  maxLength={20_000}
                  value={roleDescription}
                  onChange={(event) => setRoleDescription(event.target.value)}
                  placeholder="Project intake coordinator"
                />
              </label>
              <label className="block text-sm md:col-span-2">
                <span className="mb-1 block font-medium">
                  Core instructions
                </span>
                <textarea
                  className={`${input} min-h-36`}
                  disabled={!canEdit}
                  required
                  maxLength={20_000}
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                />
              </label>
              <fieldset className="md:col-span-2">
                <legend className="text-sm font-medium">
                  Actions this teammate may propose
                </legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {actionTypes.map(([value, label]) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        disabled={!canEdit}
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
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {canEdit ? (
                <button
                  type="submit"
                  className="rounded-lg bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={create.isPending || update.isPending}
                >
                  {selectedId ? "Save teammate" : "Create teammate"}
                </button>
              ) : null}
              {selected && canEdit ? (
                <>
                  <button
                    type="button"
                    className="rounded-lg border border-sand bg-white px-4 py-2 text-sm"
                    onClick={() =>
                      setStatus.mutate({
                        teammateId: selected.teammateId,
                        status:
                          selected.status === "active" ? "paused" : "active",
                      })
                    }
                  >
                    {selected.status === "active" ? "Pause" : "Activate"}
                  </button>
                  {canOwn ? (
                    <button
                      type="button"
                      className="text-sm text-[var(--hrmny-danger)] underline"
                      onClick={() => {
                        if (window.confirm("Archive this AI teammate?"))
                          archive.mutate({ teammateId: selected.teammateId });
                      }}
                    >
                      Archive
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </form>

          {selected ? (
            <>
              <section className={card}>
                <h2 className="font-display text-xl font-semibold">
                  Ask {selected.name}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  It can read only work both you and the teammate can access.
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">Project</span>
                    <select
                      className={input}
                      value={runProjectId}
                      onChange={(event) => setRunProjectId(event.target.value)}
                    >
                      <option value="">Choose a project</option>
                      {(projects.data ?? []).map((project) => (
                        <option
                          key={project.projectId}
                          value={project.projectId}
                        >
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">
                      Task (optional)
                    </span>
                    <select
                      className={input}
                      value={runItemId}
                      onChange={(event) => setRunItemId(event.target.value)}
                      disabled={!runProjectId || runProject.isLoading}
                    >
                      <option value="">Work at project level</option>
                      {(runProject.data?.items ?? []).map((item) => (
                        <option key={item.itemId} value={item.itemId}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm md:col-span-2">
                    <span className="mb-1 block font-medium">Request</span>
                    <textarea
                      className={`${input} min-h-28`}
                      required
                      maxLength={10_000}
                      value={requestText}
                      onChange={(event) => setRequestText(event.target.value)}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="mt-3 rounded-lg bg-ochre px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={
                    run.isPending || !runProjectId || !requestText.trim()
                  }
                  onClick={() =>
                    run.mutate({
                      teammateId: selected.teammateId,
                      projectId: runProjectId,
                      itemId: runItemId.trim() || null,
                      requestText,
                    })
                  }
                >
                  {run.isPending ? "Working…" : "Start work"}
                </button>
                {run.data?.run ? (
                  <p className="mt-3 text-sm" role="status">
                    {selected.name} finished with status {run.data.run.status}.
                    Review the result in{" "}
                    <Link className="underline" href="/work/ai">
                      Work intelligence
                    </Link>
                    .
                  </p>
                ) : null}
              </section>

              <section className="grid gap-5 lg:grid-cols-2">
                {canEdit ? (
                  <div className={card}>
                    <h2 className="font-display text-xl font-semibold">
                      Project access
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      Public projects are readable by default. Grant higher
                      access explicitly; private projects require an explicit
                      grant.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <select
                        className={input}
                        aria-label="Project to grant"
                        value={accessProjectId}
                        onChange={(event) =>
                          setAccessProjectId(event.target.value)
                        }
                      >
                        <option value="">Project</option>
                        {(projects.data ?? []).map((project) => (
                          <option
                            key={project.projectId}
                            value={project.projectId}
                          >
                            {project.name}
                          </option>
                        ))}
                      </select>
                      <select
                        className={input}
                        aria-label="Project access level"
                        value={accessLevel}
                        onChange={(event) =>
                          setAccessLevel(
                            event.target.value as
                              "editor" | "commenter" | "viewer",
                          )
                        }
                      >
                        <option value="viewer">Viewer</option>
                        <option value="commenter">Commenter</option>
                        <option value="editor">Editor</option>
                      </select>
                      <button
                        type="button"
                        className="rounded-lg bg-ink px-3 py-2 text-sm text-white"
                        disabled={!accessProjectId}
                        onClick={() =>
                          setProject.mutate({
                            teammateId: selected.teammateId,
                            projectId: accessProjectId,
                            accessLevel,
                          })
                        }
                      >
                        Grant
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {(projectAccess.data ?? []).map((access) => (
                        <div
                          key={access.projectId}
                          className="flex items-center justify-between gap-3 rounded-lg border border-sand bg-white p-3 text-sm"
                        >
                          <span>
                            {access.projectName} · {access.accessLevel}
                          </span>
                          <button
                            type="button"
                            className="underline"
                            onClick={() =>
                              removeProject.mutate({
                                teammateId: selected.teammateId,
                                projectId: access.projectId,
                              })
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {canOwn ? (
                  <div className={card}>
                    <h2 className="font-display text-xl font-semibold">
                      Shared access
                    </h2>
                    <div className="mt-3 flex gap-2">
                      <select
                        className={input}
                        aria-label="Team member to share with"
                        value={shareEmployeeId}
                        onChange={(event) =>
                          setShareEmployeeId(event.target.value)
                        }
                      >
                        <option value="">Team member</option>
                        {(directory.data ?? []).map((person) => (
                          <option
                            key={person.employeeId}
                            value={person.employeeId}
                          >
                            {person.displayName}
                          </option>
                        ))}
                      </select>
                      <select
                        className={input}
                        aria-label="Shared access level"
                        value={memberLevel}
                        onChange={(event) =>
                          setMemberLevel(
                            event.target.value as "owner" | "editor" | "user",
                          )
                        }
                      >
                        <option value="user">User</option>
                        <option value="editor">Editor</option>
                        <option value="owner">Owner</option>
                      </select>
                      <button
                        type="button"
                        className="rounded-lg bg-ink px-3 py-2 text-sm text-white"
                        disabled={!shareEmployeeId}
                        onClick={() =>
                          setMember.mutate({
                            teammateId: selected.teammateId,
                            employeeId: shareEmployeeId,
                            accessLevel: memberLevel,
                          })
                        }
                      >
                        Share
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {(members.data ?? []).map((member) => (
                        <div
                          key={member.employeeId}
                          className="flex items-center justify-between gap-3 rounded-lg border border-sand bg-white p-3 text-sm"
                        >
                          <span>
                            {member.displayName} · {member.accessLevel}
                          </span>
                          {member.employeeId !==
                          selected.createdByEmployeeId ? (
                            <button
                              type="button"
                              className="underline"
                              onClick={() =>
                                removeMember.mutate({
                                  teammateId: selected.teammateId,
                                  employeeId: member.employeeId,
                                })
                              }
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>

              {enabled.has("work.ai.teammate_skills") ? (
                <section className={card}>
                  <h2 className="font-display text-xl font-semibold">Skills</h2>
                  <p className="mt-1 text-sm text-muted">
                    Only skills whose trigger matches the request are loaded.
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="text-sm">
                      <span className="mb-1 block font-medium">Skill name</span>
                      <input
                        className={input}
                        disabled={!canEdit}
                        value={skillName}
                        onChange={(event) => setSkillName(event.target.value)}
                      />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block font-medium">
                        When to use it
                      </span>
                      <input
                        className={input}
                        disabled={!canEdit}
                        value={skillTrigger}
                        onChange={(event) =>
                          setSkillTrigger(event.target.value)
                        }
                      />
                    </label>
                    <label className="text-sm md:col-span-2">
                      <span className="mb-1 block font-medium">Guidance</span>
                      <textarea
                        className={`${input} min-h-24`}
                        disabled={!canEdit}
                        value={skillGuidance}
                        onChange={(event) =>
                          setSkillGuidance(event.target.value)
                        }
                      />
                    </label>
                    <label className="text-sm md:col-span-2">
                      <span className="mb-1 block font-medium">
                        Reference material (optional)
                      </span>
                      <textarea
                        className={`${input} min-h-20`}
                        disabled={!canEdit}
                        value={skillReference}
                        onChange={(event) =>
                          setSkillReference(event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm text-white"
                    disabled={
                      !canEdit || !skillName.trim() || !skillGuidance.trim()
                    }
                    onClick={() =>
                      saveSkill.mutate({
                        teammateId: selected.teammateId,
                        skill: {
                          name: skillName,
                          guidance: skillGuidance,
                          triggerCondition: skillTrigger,
                          referenceText: skillReference,
                          isActive: true,
                        },
                      })
                    }
                  >
                    Add skill
                  </button>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {(skills.data ?? []).map((skill) => (
                      <article
                        key={skill.skillId}
                        className="rounded-lg border border-sand bg-white p-3 text-sm"
                      >
                        <p className="font-semibold">{skill.name}</p>
                        <p className="mt-1 text-muted">
                          {skill.triggerCondition}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap">
                          {skill.guidance}
                        </p>
                        <button
                          type="button"
                          className="mt-2 text-[var(--hrmny-danger)] underline"
                          disabled={!canEdit}
                          onClick={() =>
                            deleteSkill.mutate({
                              teammateId: selected.teammateId,
                              skillId: skill.skillId,
                            })
                          }
                        >
                          Delete
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {enabled.has("work.ai.teammate_memory") ? (
                <section className={card}>
                  <h2 className="font-display text-xl font-semibold">Memory</h2>
                  <p className="mt-1 text-sm text-muted">
                    Memories remain tied to their source task and disappear when
                    either you or the teammate loses access.
                  </p>
                  <div className="mt-3 space-y-2">
                    {(memories.data ?? []).map((memory) => (
                      <article
                        key={memory.memoryId}
                        className="rounded-lg border border-sand bg-white p-3 text-sm"
                      >
                        <p className="whitespace-pre-wrap">{memory.content}</p>
                        <div className="mt-2 flex justify-between gap-3 text-xs text-muted">
                          <span>{memory.itemTitle ?? "Source task"}</span>
                          <button
                            type="button"
                            className="underline"
                            disabled={!canEdit}
                            onClick={() =>
                              forgetMemory.mutate({
                                teammateId: selected.teammateId,
                                memoryId: memory.memoryId,
                              })
                            }
                          >
                            Forget
                          </button>
                        </div>
                      </article>
                    ))}
                    {!memories.data?.length ? (
                      <p className="text-sm text-muted">No memories yet.</p>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-[var(--hrmny-danger)]">
              {error.message}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
