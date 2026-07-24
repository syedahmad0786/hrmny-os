"use client";

import { useEffect, useState } from "react";
import { WorkNav } from "@/components/work-nav";
import { trpc } from "@/lib/trpc";

type Answers = Record<string, Record<string, unknown>>;

export default function WorkflowsPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const enabled = new Set(session.data?.enabledFeatureKeys ?? []);
  const formsEnabled = enabled.has("work.forms");
  const rulesEnabled = enabled.has("work.rules");
  const templatesEnabled = enabled.has("work.templates");
  const bundlesEnabled = enabled.has("work.bundles");
  const approvalsEnabled = enabled.has("work.approvals");
  const projects = trpc.work.projects.list.useQuery();
  const [projectId, setProjectId] = useState("");
  useEffect(() => {
    if (!projectId && projects.data?.[0])
      setProjectId(projects.data[0].projectId);
  }, [projectId, projects.data]);
  const detail = trpc.work.projects.get.useQuery(
    { projectId },
    { enabled: Boolean(projectId) },
  );
  const employees = trpc.work.members.listEmployees.useQuery();
  const tags = trpc.work.tags.list.useQuery(
    { projectId },
    { enabled: Boolean(projectId && rulesEnabled) },
  );
  const forms = trpc.work.forms.list.useQuery(
    { projectId },
    { enabled: Boolean(projectId && formsEnabled) },
  );
  const rules = trpc.work.rules.list.useQuery(
    { projectId },
    { enabled: Boolean(projectId && rulesEnabled) },
  );
  const ruleRuns = trpc.work.rules.runs.useQuery(
    { projectId, limit: 20 },
    { enabled: Boolean(projectId && rulesEnabled) },
  );
  const templates = trpc.work.templates.list.useQuery(
    { projectId },
    { enabled: Boolean(projectId && templatesEnabled) },
  );
  const bundles = trpc.work.bundles.list.useQuery(undefined, {
    enabled: bundlesEnabled,
  });
  const approvals = trpc.work.approvals.list.useQuery(
    { projectId },
    { enabled: Boolean(projectId && approvalsEnabled) },
  );

  const [formName, setFormName] = useState("");
  const [formQuestions, setFormQuestions] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  const createForm = trpc.work.forms.create.useMutation({
    onSuccess: async () => {
      setFormName("");
      setFormQuestions("");
      await utils.work.forms.list.invalidate();
    },
  });
  const setFormActive = trpc.work.forms.setActive.useMutation({
    onSuccess: () => utils.work.forms.list.invalidate(),
  });
  const submitForm = trpc.work.forms.submit.useMutation({
    onSuccess: async (_, input) => {
      setAnswers((current) => ({ ...current, [input.formId]: {} }));
      await utils.work.projects.get.invalidate();
    },
  });

  const [ruleName, setRuleName] = useState("");
  const [triggerType, setTriggerType] = useState<
    "task_added" | "task_completed" | "task_moved"
  >("task_added");
  const [conditionPriority, setConditionPriority] = useState("");
  const [actionType, setActionType] = useState<
    "set_priority" | "move_section" | "assign" | "complete" | "add_tag"
  >("set_priority");
  const [actionValue, setActionValue] = useState("high");
  const createRule = trpc.work.rules.create.useMutation({
    onSuccess: async () => {
      setRuleName("");
      await utils.work.rules.list.invalidate();
    },
  });
  const setRuleEnabled = trpc.work.rules.setEnabled.useMutation({
    onSuccess: () => utils.work.rules.list.invalidate(),
  });

  const [taskTemplateName, setTaskTemplateName] = useState("");
  const [taskTemplateTitle, setTaskTemplateTitle] = useState("");
  const [taskDueDays, setTaskDueDays] = useState("7");
  const [projectTemplateName, setProjectTemplateName] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const createTaskTemplate = trpc.work.templates.createTask.useMutation({
    onSuccess: () => utils.work.templates.list.invalidate(),
  });
  const captureProjectTemplate = trpc.work.templates.captureProject.useMutation(
    {
      onSuccess: () => utils.work.templates.list.invalidate(),
    },
  );
  const instantiateTask = trpc.work.templates.instantiateTask.useMutation({
    onSuccess: () => utils.work.projects.get.invalidate(),
  });
  const instantiateProject = trpc.work.templates.instantiateProject.useMutation(
    {
      onSuccess: () => utils.work.projects.list.invalidate(),
    },
  );

  const [bundleName, setBundleName] = useState("");
  const captureBundle = trpc.work.bundles.capture.useMutation({
    onSuccess: () => utils.work.bundles.list.invalidate(),
  });
  const publishBundle = trpc.work.bundles.publish.useMutation({
    onSuccess: () => utils.work.bundles.list.invalidate(),
  });
  const applyBundle = trpc.work.bundles.applyToProject.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.projects.get.invalidate(),
        utils.work.rules.list.invalidate(),
        utils.work.templates.list.invalidate(),
      ]);
    },
  });

  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>(
    {},
  );
  const [approvalTitle, setApprovalTitle] = useState("");
  const createApproval = trpc.work.tasks.create.useMutation({
    onSuccess: async () => {
      setApprovalTitle("");
      await Promise.all([
        utils.work.approvals.list.invalidate(),
        utils.work.projects.get.invalidate(),
      ]);
    },
  });
  const decideApproval = trpc.work.approvals.decide.useMutation({
    onSuccess: () => utils.work.approvals.list.invalidate(),
  });
  const reopenApproval = trpc.work.approvals.reopen.useMutation({
    onSuccess: () => utils.work.approvals.list.invalidate(),
  });

  const sections = detail.data?.sections ?? [];
  const error =
    createForm.error ??
    submitForm.error ??
    createRule.error ??
    createTaskTemplate.error ??
    captureProjectTemplate.error ??
    instantiateTask.error ??
    instantiateProject.error ??
    captureBundle.error ??
    publishBundle.error ??
    applyBundle.error ??
    createApproval.error ??
    decideApproval.error;

  return (
    <main className="flex flex-col gap-5">
      <WorkNav />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
            Standardise work
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">
            Workflows
          </h1>
          <p className="mt-2 text-sm text-muted">
            Intake, automate, reuse, distribute, and approve work.
          </p>
        </div>
        <select
          aria-label="Project"
          className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          {(projects.data ?? []).map((project) => (
            <option key={project.projectId} value={project.projectId}>
              {project.name}
            </option>
          ))}
        </select>
      </header>

      {formsEnabled ? (
        <section className="rounded-xl border border-sand bg-white/70 p-5">
          <h2 className="font-display text-xl">Forms</h2>
          <p className="mt-1 text-sm text-muted">
            Every submission becomes a task in this project.
          </p>
          <form
            className="mt-4 grid gap-2 md:grid-cols-[1fr_2fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              const extra = formQuestions
                .split(",")
                .map((label) => label.trim())
                .filter(Boolean)
                .map((label, index) => ({
                  key: `question_${index + 1}`,
                  label,
                  type: "text" as const,
                  required: false,
                  options: [],
                }));
              createForm.mutate({
                projectId,
                name: formName,
                description: "",
                titleQuestionKey: "title",
                questions: [
                  {
                    key: "title",
                    label: "Request title",
                    type: "text",
                    required: true,
                    options: [],
                  },
                  ...extra,
                ],
                confirmationMessage: "Your request was submitted.",
              });
            }}
          >
            <input
              aria-label="Form name"
              className="rounded border border-sand px-3 py-2"
              placeholder="Form name"
              value={formName}
              onChange={(event) => setFormName(event.target.value)}
            />
            <input
              aria-label="Extra form questions"
              className="rounded border border-sand px-3 py-2"
              placeholder="Extra questions, comma separated"
              value={formQuestions}
              onChange={(event) => setFormQuestions(event.target.value)}
            />
            <button
              className="rounded bg-ink px-4 py-2 text-white"
              disabled={!projectId || !formName.trim()}
            >
              Create form
            </button>
          </form>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {(forms.data ?? []).map((form) => {
              const formAnswers = answers[form.formId] ?? {};
              return (
                <article
                  key={form.formId}
                  className="rounded-lg border border-sand bg-white p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold">{form.name}</h3>
                    <button
                      type="button"
                      className="rounded-full border border-sand px-2 py-1 text-xs"
                      onClick={() =>
                        setFormActive.mutate({
                          formId: form.formId,
                          active: !form.isActive,
                        })
                      }
                    >
                      {form.isActive ? "Active" : "Paused"}
                    </button>
                  </div>
                  {form.isActive ? (
                    <form
                      className="mt-3 space-y-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitForm.mutate({
                          formId: form.formId,
                          answers: formAnswers,
                        });
                      }}
                    >
                      {form.questions.map((question) => {
                        if (
                          question.showWhen &&
                          formAnswers[question.showWhen.key] !==
                            question.showWhen.equals
                        )
                          return null;
                        return (
                          <label
                            key={question.key}
                            className="block text-xs font-medium"
                          >
                            {question.label}
                            {question.required ? " *" : ""}
                            {question.type === "checkbox" ? (
                              <input
                                className="ml-2"
                                type="checkbox"
                                checked={formAnswers[question.key] === true}
                                onChange={(event) =>
                                  setAnswers((current) => ({
                                    ...current,
                                    [form.formId]: {
                                      ...formAnswers,
                                      [question.key]: event.target.checked,
                                    },
                                  }))
                                }
                              />
                            ) : question.type === "single_select" ? (
                              <select
                                className="mt-1 w-full rounded border border-sand px-2 py-1.5"
                                value={String(formAnswers[question.key] ?? "")}
                                onChange={(event) =>
                                  setAnswers((current) => ({
                                    ...current,
                                    [form.formId]: {
                                      ...formAnswers,
                                      [question.key]: event.target.value,
                                    },
                                  }))
                                }
                              >
                                <option value="">Choose…</option>
                                {question.options.map((option) => (
                                  <option key={option}>{option}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                className="mt-1 w-full rounded border border-sand px-2 py-1.5"
                                type={
                                  question.type === "number"
                                    ? "number"
                                    : question.type === "date"
                                      ? "date"
                                      : "text"
                                }
                                value={String(formAnswers[question.key] ?? "")}
                                onChange={(event) =>
                                  setAnswers((current) => ({
                                    ...current,
                                    [form.formId]: {
                                      ...formAnswers,
                                      [question.key]:
                                        question.type === "number"
                                          ? Number(event.target.value)
                                          : event.target.value,
                                    },
                                  }))
                                }
                              />
                            )}
                          </label>
                        );
                      })}
                      <button className="rounded bg-ochre px-3 py-1.5 text-sm text-white">
                        Submit
                      </button>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {rulesEnabled ? (
        <section className="rounded-xl border border-sand bg-white/70 p-5">
          <h2 className="font-display text-xl">Rules</h2>
          <form
            className="mt-4 grid gap-2 md:grid-cols-3 lg:grid-cols-6"
            onSubmit={(event) => {
              event.preventDefault();
              const action =
                actionType === "set_priority"
                  ? {
                      type: actionType,
                      value: actionValue as
                        "low" | "medium" | "high" | "urgent",
                    }
                  : actionType === "move_section"
                    ? { type: actionType, sectionId: actionValue }
                    : actionType === "assign"
                      ? { type: actionType, employeeId: actionValue || null }
                      : actionType === "add_tag"
                        ? { type: actionType, tagId: actionValue }
                        : { type: actionType };
              createRule.mutate({
                projectId,
                name: ruleName,
                triggerType,
                branches: [
                  {
                    mode: "all",
                    conditions: conditionPriority
                      ? [
                          {
                            field: "priority",
                            operator: "equals",
                            value: conditionPriority,
                          },
                        ]
                      : [],
                    actions: [action],
                  },
                ],
              });
            }}
          >
            <input
              aria-label="Rule name"
              className="rounded border border-sand px-2 py-1.5"
              placeholder="Rule name"
              value={ruleName}
              onChange={(event) => setRuleName(event.target.value)}
            />
            <select
              aria-label="Rule trigger"
              className="rounded border border-sand px-2 py-1.5"
              value={triggerType}
              onChange={(event) =>
                setTriggerType(event.target.value as typeof triggerType)
              }
            >
              <option value="task_added">Task added</option>
              <option value="task_completed">Task completed</option>
              <option value="task_moved">Task moved</option>
            </select>
            <select
              aria-label="Rule priority condition"
              className="rounded border border-sand px-2 py-1.5"
              value={conditionPriority}
              onChange={(event) => setConditionPriority(event.target.value)}
            >
              <option value="">Any priority</option>
              <option value="high">High priority</option>
              <option value="urgent">Urgent priority</option>
            </select>
            <select
              aria-label="Rule action"
              className="rounded border border-sand px-2 py-1.5"
              value={actionType}
              onChange={(event) => {
                const value = event.target.value as typeof actionType;
                setActionType(value);
                setActionValue(value === "set_priority" ? "high" : "");
              }}
            >
              <option value="set_priority">Set priority</option>
              <option value="move_section">Move section</option>
              <option value="assign">Assign</option>
              <option value="complete">Complete</option>
              <option value="add_tag">Add tag</option>
            </select>
            {actionType === "set_priority" ? (
              <select
                aria-label="Priority to set"
                className="rounded border border-sand px-2 py-1.5"
                value={actionValue}
                onChange={(event) => setActionValue(event.target.value)}
              >
                {["low", "medium", "high", "urgent"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            ) : actionType === "move_section" ? (
              <select
                aria-label="Section to move to"
                className="rounded border border-sand px-2 py-1.5"
                value={actionValue}
                onChange={(event) => setActionValue(event.target.value)}
              >
                <option value="">Choose section</option>
                {sections.map((section) => (
                  <option key={section.sectionId} value={section.sectionId}>
                    {section.name}
                  </option>
                ))}
              </select>
            ) : actionType === "assign" ? (
              <select
                aria-label="Person to assign"
                className="rounded border border-sand px-2 py-1.5"
                value={actionValue}
                onChange={(event) => setActionValue(event.target.value)}
              >
                <option value="">Unassigned</option>
                {(employees.data ?? []).map((employee) => (
                  <option key={employee.employeeId} value={employee.employeeId}>
                    {employee.displayName}
                  </option>
                ))}
              </select>
            ) : actionType === "add_tag" ? (
              <select
                aria-label="Tag to add"
                className="rounded border border-sand px-2 py-1.5"
                value={actionValue}
                onChange={(event) => setActionValue(event.target.value)}
              >
                <option value="">Choose tag</option>
                {(tags.data ?? []).map((tag) => (
                  <option key={tag.tagId} value={tag.tagId}>
                    {tag.name}
                  </option>
                ))}
              </select>
            ) : (
              <span />
            )}
            <button
              className="rounded bg-ink px-3 py-1.5 text-white"
              disabled={
                !ruleName.trim() ||
                (["move_section", "add_tag"].includes(actionType) &&
                  !actionValue)
              }
            >
              Create rule
            </button>
          </form>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              {(rules.data ?? []).map((rule) => (
                <div
                  key={rule.ruleId}
                  className="flex items-center justify-between rounded border border-sand bg-white p-3 text-sm"
                >
                  <span>
                    <strong>{rule.name}</strong> ·{" "}
                    {rule.triggerType.replaceAll("_", " ")}
                  </span>
                  <button
                    className="rounded-full border border-sand px-2 py-1 text-xs"
                    onClick={() =>
                      setRuleEnabled.mutate({
                        ruleId: rule.ruleId,
                        enabled: !rule.isEnabled,
                      })
                    }
                  >
                    {rule.isEnabled ? "On" : "Off"}
                  </button>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {(ruleRuns.data ?? []).slice(0, 8).map((run) => (
                <p
                  key={run.ruleRunId}
                  className="rounded border border-sand bg-white p-2 text-xs"
                >
                  {run.status} · {new Date(run.createdAt).toLocaleString()}
                  {run.errorMessage ? ` · ${run.errorMessage}` : ""}
                </p>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {templatesEnabled ? (
        <section className="rounded-xl border border-sand bg-white/70 p-5">
          <h2 className="font-display text-xl">Templates</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                createTaskTemplate.mutate({
                  projectId,
                  name: taskTemplateName,
                  blueprint: {
                    title: taskTemplateTitle,
                    description: "",
                    itemType: "task",
                    priority: null,
                    dueInDays: Number(taskDueDays),
                    subtasks: [],
                  },
                });
              }}
            >
              <h3 className="font-semibold">New task template</h3>
              <input
                aria-label="Task template name"
                className="rounded border border-sand px-2 py-1.5"
                placeholder="Template name"
                value={taskTemplateName}
                onChange={(event) => setTaskTemplateName(event.target.value)}
              />
              <input
                aria-label="Task template title"
                className="rounded border border-sand px-2 py-1.5"
                placeholder="Task title"
                value={taskTemplateTitle}
                onChange={(event) => setTaskTemplateTitle(event.target.value)}
              />
              <input
                aria-label="Task due in days"
                className="rounded border border-sand px-2 py-1.5"
                type="number"
                min="-3650"
                max="3650"
                value={taskDueDays}
                onChange={(event) => setTaskDueDays(event.target.value)}
              />
              <button
                className="rounded bg-ink px-3 py-1.5 text-white"
                disabled={!taskTemplateName.trim() || !taskTemplateTitle.trim()}
              >
                Save task template
              </button>
            </form>
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                captureProjectTemplate.mutate({
                  projectId,
                  name: projectTemplateName,
                });
              }}
            >
              <h3 className="font-semibold">Save this project as a template</h3>
              <input
                aria-label="Project template name"
                className="rounded border border-sand px-2 py-1.5"
                placeholder="Project template name"
                value={projectTemplateName}
                onChange={(event) => setProjectTemplateName(event.target.value)}
              />
              <button
                className="rounded bg-ink px-3 py-1.5 text-white"
                disabled={!projectTemplateName.trim()}
              >
                Capture project
              </button>
            </form>
          </div>
          <div className="mt-5 grid gap-2 md:grid-cols-2">
            {(templates.data ?? []).map((template) => (
              <div
                key={template.templateId}
                className="rounded border border-sand bg-white p-3"
              >
                <p className="font-semibold">{template.name}</p>
                <p className="text-xs uppercase text-muted">
                  {template.templateType}
                </p>
                {template.templateType === "task" ? (
                  <button
                    className="mt-2 rounded border border-sand px-3 py-1 text-sm"
                    onClick={() =>
                      instantiateTask.mutate({
                        templateId: template.templateId,
                        projectId,
                        sectionId: sections[0]?.sectionId ?? null,
                      })
                    }
                  >
                    Create task
                  </button>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <input
                      aria-label={`New project name for ${template.name}`}
                      className="min-w-0 flex-1 rounded border border-sand px-2 py-1 text-sm"
                      placeholder="New project name"
                      value={newProjectName}
                      onChange={(event) =>
                        setNewProjectName(event.target.value)
                      }
                    />
                    <button
                      className="rounded border border-sand px-3 py-1 text-sm"
                      disabled={!newProjectName.trim()}
                      onClick={() =>
                        instantiateProject.mutate({
                          templateId: template.templateId,
                          name: newProjectName,
                          referenceDate: new Date().toISOString().slice(0, 10),
                        })
                      }
                    >
                      Use
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {bundlesEnabled ? (
        <section className="rounded-xl border border-sand bg-white/70 p-5">
          <h2 className="font-display text-xl">Bundles</h2>
          <p className="mt-1 text-sm text-muted">
            Package sections, fields, rules, and task templates, then apply
            updates to projects.
          </p>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              captureBundle.mutate({
                projectId,
                name: bundleName,
                description: "",
                visibility: "organization",
              });
            }}
          >
            <input
              aria-label="Bundle name"
              className="min-w-0 flex-1 rounded border border-sand px-3 py-2"
              placeholder="Bundle name"
              value={bundleName}
              onChange={(event) => setBundleName(event.target.value)}
            />
            <button
              className="rounded bg-ink px-4 py-2 text-white"
              disabled={!bundleName.trim()}
            >
              Capture
            </button>
          </form>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {(bundles.data ?? []).map((bundle) => (
              <div
                key={bundle.bundleId}
                className="rounded border border-sand bg-white p-3"
              >
                <p className="font-semibold">
                  {bundle.name}{" "}
                  <span className="text-xs text-muted">v{bundle.version}</span>
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    className="rounded border border-sand px-2 py-1 text-sm"
                    onClick={() =>
                      applyBundle.mutate({
                        bundleId: bundle.bundleId,
                        projectId,
                      })
                    }
                  >
                    Apply here
                  </button>
                  {bundle.createdByEmployeeId === session.data?.employeeId ? (
                    <button
                      className="rounded border border-sand px-2 py-1 text-sm"
                      onClick={() =>
                        publishBundle.mutate({
                          bundleId: bundle.bundleId,
                          sourceProjectId: projectId,
                        })
                      }
                    >
                      Publish update
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {approvalsEnabled ? (
        <section className="rounded-xl border border-sand bg-white/70 p-5">
          <h2 className="font-display text-xl">Approvals</h2>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              createApproval.mutate({
                projectId,
                sectionId: sections[0]?.sectionId ?? null,
                title: approvalTitle,
                description: "",
                itemType: "approval",
              });
            }}
          >
            <input
              aria-label="Approval title"
              className="min-w-0 flex-1 rounded border border-sand px-3 py-2"
              placeholder="What needs approval?"
              value={approvalTitle}
              onChange={(event) => setApprovalTitle(event.target.value)}
            />
            <button
              className="rounded bg-ink px-4 py-2 text-white"
              disabled={!projectId || !approvalTitle.trim()}
            >
              Add approval
            </button>
          </form>
          <div className="mt-4 space-y-3">
            {(approvals.data ?? []).map((approval) => (
              <article
                key={approval.itemId}
                className="rounded border border-sand bg-white p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{approval.title}</p>
                    <p className="text-xs text-muted">
                      {approval.decision
                        ? approval.decision.decision.replaceAll("_", " ")
                        : "Pending"}
                    </p>
                  </div>
                  {approval.completedAt ? (
                    <button
                      className="rounded border border-sand px-3 py-1 text-sm"
                      onClick={() =>
                        reopenApproval.mutate({ itemId: approval.itemId })
                      }
                    >
                      Reopen
                    </button>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(
                        ["approved", "changes_requested", "rejected"] as const
                      ).map((decision) => (
                        <button
                          key={decision}
                          className="rounded border border-sand px-2 py-1 text-sm"
                          onClick={() =>
                            decideApproval.mutate({
                              itemId: approval.itemId,
                              decision,
                              note: approvalNotes[approval.itemId] ?? "",
                            })
                          }
                        >
                          {decision.replaceAll("_", " ")}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {!approval.completedAt ? (
                  <input
                    aria-label={`Decision note for ${approval.title}`}
                    className="mt-2 w-full rounded border border-sand px-2 py-1 text-sm"
                    placeholder="Decision note"
                    value={approvalNotes[approval.itemId] ?? ""}
                    onChange={(event) =>
                      setApprovalNotes((current) => ({
                        ...current,
                        [approval.itemId]: event.target.value,
                      }))
                    }
                  />
                ) : null}
              </article>
            ))}
            {!approvals.isLoading && !approvals.data?.length ? (
              <p className="text-sm text-muted">
                No approval tasks in this project.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error.message}</p> : null}
    </main>
  );
}
