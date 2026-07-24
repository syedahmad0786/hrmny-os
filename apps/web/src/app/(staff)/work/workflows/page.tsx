"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { WorkNav } from "@/components/work-nav";
import { trpc } from "@/lib/trpc";

type Answers = Record<string, Record<string, unknown>>;

function fileAnswer(file: File) {
  return new Promise<{
    fileName: string;
    contentType: string;
    contentBase64: string;
  }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () =>
      resolve({
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        contentBase64: String(reader.result).split(",")[1] ?? "",
      });
    reader.readAsDataURL(file);
  });
}

export default function WorkflowsPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
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
  const enabled = new Set(
    detail.data?.enabledFeatureKeys ??
      (projectId ? [] : session.data?.enabledFeatureKeys) ??
      [],
  );
  const formsEnabled = enabled.has("work.forms");
  const publicFormsEnabled = enabled.has("work.forms.public");
  const rulesEnabled = enabled.has("work.rules");
  const scheduledRulesEnabled = enabled.has("work.rules.scheduled");
  const collaboratorRulesEnabled = enabled.has(
    "work.rules.collaborator_trigger",
  );
  const externalRulesEnabled =
    enabled.has("work.rules.external_actions") &&
    enabled.has("work.api_webhooks");
  const customTaskTypesEnabled = enabled.has("work.custom_task_types");
  const templatesEnabled = enabled.has("work.templates");
  const templateRolesEnabled = enabled.has("work.templates.roles");
  const bundlesEnabled = enabled.has("work.bundles");
  const approvalsEnabled = enabled.has("work.approvals");
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
  const customTaskTypes = trpc.work.customTaskTypes.list.useQuery(
    { projectId },
    { enabled: Boolean(projectId && rulesEnabled && customTaskTypesEnabled) },
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
  const [formAccessLevel, setFormAccessLevel] = useState<
    "organization" | "anyone"
  >("organization");
  const [formAttachment, setFormAttachment] = useState(false);
  const [answers, setAnswers] = useState<Answers>({});
  const createForm = trpc.work.forms.create.useMutation({
    onSuccess: async () => {
      setFormName("");
      setFormQuestions("");
      setFormAttachment(false);
      await utils.work.forms.list.invalidate();
    },
  });
  const setFormAccess = trpc.work.forms.setAccess.useMutation({
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
    | "task_added"
    | "task_completed"
    | "task_moved"
    | "priority_changed"
    | "due_date_set"
    | "approval_decided"
    | "custom_status_changed"
    | "collaborator_added"
    | "scheduled"
  >("task_added");
  const [scheduleMinutes, setScheduleMinutes] = useState("1440");
  const [conditionPriority, setConditionPriority] = useState("");
  const [conditionCustomStatus, setConditionCustomStatus] = useState("");
  const [actionType, setActionType] = useState<
    | "set_priority"
    | "move_section"
    | "assign"
    | "complete"
    | "add_tag"
    | "send_webhook"
    | "set_custom_task_status"
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
  const [projectTemplateRoleNames, setProjectTemplateRoleNames] = useState<
    Record<string, string>
  >({});
  const [templateRoleAssignments, setTemplateRoleAssignments] = useState<
    Record<string, string>
  >({});
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
    onSuccess: async () => {
      await Promise.all([
        utils.work.bundles.list.invalidate(),
        utils.work.projects.get.invalidate(),
        utils.work.rules.list.invalidate(),
        utils.work.templates.list.invalidate(),
      ]);
    },
  });
  const applyBundle = trpc.work.bundles.applyToProject.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.bundles.list.invalidate(),
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
  const projectAssignees = [
    ...new Map(
      (detail.data?.items ?? []).flatMap((item) =>
        item.assigneeEmployeeId
          ? [
              [
                item.assigneeEmployeeId,
                {
                  employeeId: item.assigneeEmployeeId,
                  name: item.assigneeName ?? "Project role",
                },
              ] as const,
            ]
          : [],
      ),
    ).values(),
  ];
  const error =
    createForm.error ??
    setFormAccess.error ??
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
            className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-[1fr_2fr_auto_auto_auto]"
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
                  ...(formAttachment
                    ? [
                        {
                          key: "attachments",
                          label: "Attachments",
                          type: "attachment" as const,
                          required: false,
                          options: [],
                          multiple: true,
                        },
                      ]
                    : []),
                ],
                confirmationMessage: "Your request was submitted.",
                accessLevel: publicFormsEnabled
                  ? formAccessLevel
                  : "organization",
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
            <select
              aria-label="Form access"
              className="rounded border border-sand px-3 py-2"
              value={publicFormsEnabled ? formAccessLevel : "organization"}
              onChange={(event) =>
                setFormAccessLevel(
                  event.target.value as "organization" | "anyone",
                )
              }
            >
              <option value="organization">Organization only</option>
              <option value="anyone" disabled={!publicFormsEnabled}>
                Anyone with link
              </option>
            </select>
            <label className="flex items-center gap-2 rounded border border-sand px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={formAttachment}
                onChange={(event) => setFormAttachment(event.target.checked)}
              />
              File upload
            </label>
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
                    <select
                      aria-label={`${form.name} access`}
                      className="rounded-full border border-sand px-2 py-1 text-xs"
                      value={form.accessLevel}
                      onChange={(event) =>
                        setFormAccess.mutate({
                          formId: form.formId,
                          accessLevel: event.target.value as
                            "organization" | "anyone" | "deactivated",
                        })
                      }
                    >
                      <option value="organization">Organization only</option>
                      <option value="anyone" disabled={!publicFormsEnabled}>
                        Anyone with link
                      </option>
                      <option value="deactivated">Deactivated</option>
                    </select>
                  </div>
                  {form.accessLevel === "anyone" && publicFormsEnabled ? (
                    <Link
                      className="mt-2 inline-block text-xs font-semibold text-ochre underline"
                      href={`/forms/${form.formId}`}
                      target="_blank"
                    >
                      Open public form
                    </Link>
                  ) : null}
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
                            ) : question.type === "multi_select" ? (
                              <select
                                className="mt-1 min-h-24 w-full rounded border border-sand px-2 py-1.5"
                                multiple
                                value={
                                  (formAnswers[question.key] as
                                    string[] | undefined) ?? []
                                }
                                onChange={(event) =>
                                  setAnswers((current) => ({
                                    ...current,
                                    [form.formId]: {
                                      ...formAnswers,
                                      [question.key]: [
                                        ...event.target.selectedOptions,
                                      ].map((option) => option.value),
                                    },
                                  }))
                                }
                              >
                                {question.options.map((option) => (
                                  <option key={option}>{option}</option>
                                ))}
                              </select>
                            ) : question.type === "attachment" ? (
                              <input
                                className="mt-1 w-full rounded border border-sand px-2 py-1.5"
                                type="file"
                                multiple={question.multiple}
                                onChange={async (event) => {
                                  const files = [...(event.target.files ?? [])];
                                  const encoded = await Promise.all(
                                    files.map(fileAnswer),
                                  );
                                  setAnswers((current) => ({
                                    ...current,
                                    [form.formId]: {
                                      ...formAnswers,
                                      [question.key]: encoded,
                                    },
                                  }));
                                }}
                              />
                            ) : question.type === "textarea" ? (
                              <textarea
                                className="mt-1 min-h-24 w-full rounded border border-sand px-2 py-1.5"
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
                              />
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
              const selectedActionType = (customTaskTypes.data ?? []).find(
                (type) =>
                  type.isAssociated &&
                  type.accessLevel !== "none" &&
                  type.statuses.some(
                    (status) => status.statusOptionId === actionValue,
                  ),
              );
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
                        : actionType === "set_custom_task_status"
                          ? {
                              type: actionType,
                              customTaskTypeId:
                                selectedActionType!.customTaskTypeId,
                              statusOptionId: actionValue,
                            }
                          : actionType === "send_webhook"
                            ? { type: actionType, message: actionValue }
                            : { type: actionType };
              createRule.mutate({
                projectId,
                name: ruleName,
                triggerType,
                scheduleMinutes:
                  triggerType === "scheduled" ? Number(scheduleMinutes) : null,
                branches: [
                  {
                    mode: "all",
                    conditions: [
                      ...(conditionPriority
                        ? [
                            {
                              field: "priority" as const,
                              operator: "equals" as const,
                              value: conditionPriority,
                            },
                          ]
                        : []),
                      ...(conditionCustomStatus
                        ? [
                            {
                              field: "customTaskStatusOptionId" as const,
                              operator: "equals" as const,
                              value: conditionCustomStatus,
                            },
                          ]
                        : []),
                    ],
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
              <option value="priority_changed">Priority changed</option>
              <option value="due_date_set">Due date set</option>
              <option value="approval_decided">Approval decided</option>
              {customTaskTypesEnabled ? (
                <option value="custom_status_changed">
                  Custom status changed
                </option>
              ) : null}
              {collaboratorRulesEnabled ? (
                <option value="collaborator_added">Collaborator added</option>
              ) : null}
              {scheduledRulesEnabled ? (
                <option value="scheduled">On a schedule</option>
              ) : null}
            </select>
            {triggerType === "scheduled" ? (
              <input
                aria-label="Schedule interval in minutes"
                className="rounded border border-sand px-2 py-1.5"
                type="number"
                min={15}
                max={525600}
                value={scheduleMinutes}
                onChange={(event) => setScheduleMinutes(event.target.value)}
              />
            ) : null}
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
            {customTaskTypesEnabled ? (
              <select
                aria-label="Rule custom status condition"
                className="rounded border border-sand px-2 py-1.5"
                value={conditionCustomStatus}
                onChange={(event) =>
                  setConditionCustomStatus(event.target.value)
                }
              >
                <option value="">Any custom status</option>
                {(customTaskTypes.data ?? [])
                  .filter(
                    (type) => type.isAssociated && type.accessLevel !== "none",
                  )
                  .flatMap((type) =>
                    type.statuses
                      .filter((status) => status.enabled)
                      .map((status) => (
                        <option
                          key={status.statusOptionId}
                          value={status.statusOptionId}
                        >
                          {type.icon} {type.name}: {status.name}
                        </option>
                      )),
                  )}
              </select>
            ) : null}
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
              {customTaskTypesEnabled ? (
                <option value="set_custom_task_status">
                  Set custom status
                </option>
              ) : null}
              {externalRulesEnabled ? (
                <option value="send_webhook">Send signed webhook</option>
              ) : null}
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
                    {employee.displayLabel}
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
            ) : actionType === "set_custom_task_status" ? (
              <select
                aria-label="Custom task status to set"
                className="rounded border border-sand px-2 py-1.5"
                value={actionValue}
                onChange={(event) => setActionValue(event.target.value)}
              >
                <option value="">Choose status</option>
                {(customTaskTypes.data ?? [])
                  .filter(
                    (type) => type.isAssociated && type.accessLevel !== "none",
                  )
                  .flatMap((type) =>
                    type.statuses
                      .filter((status) => status.enabled)
                      .map((status) => (
                        <option
                          key={status.statusOptionId}
                          value={status.statusOptionId}
                        >
                          {type.icon} {type.name}: {status.name}
                        </option>
                      )),
                  )}
              </select>
            ) : actionType === "send_webhook" ? (
              <input
                aria-label="Webhook message"
                className="rounded border border-sand px-2 py-1.5"
                maxLength={2000}
                placeholder="Message for the external workflow"
                value={actionValue}
                onChange={(event) => setActionValue(event.target.value)}
              />
            ) : (
              <span />
            )}
            <button
              className="rounded bg-ink px-3 py-1.5 text-white"
              disabled={
                !ruleName.trim() ||
                (triggerType === "scheduled" &&
                  (!Number.isInteger(Number(scheduleMinutes)) ||
                    Number(scheduleMinutes) < 15 ||
                    Number(scheduleMinutes) > 525600)) ||
                ([
                  "move_section",
                  "add_tag",
                  "set_custom_task_status",
                  "send_webhook",
                ].includes(actionType) &&
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
                    {rule.scheduleMinutes
                      ? ` · every ${rule.scheduleMinutes} minutes`
                      : ""}
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
                  roles: templateRolesEnabled
                    ? projectAssignees.map((assignee) => ({
                        employeeId: assignee.employeeId,
                        name:
                          projectTemplateRoleNames[
                            assignee.employeeId
                          ]?.trim() || assignee.name,
                      }))
                    : [],
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
              {templateRolesEnabled && projectAssignees.length ? (
                <fieldset className="grid gap-2 rounded border border-sand p-3">
                  <legend className="px-1 text-sm font-semibold">
                    Task assignment roles
                  </legend>
                  <p className="text-xs text-muted">
                    Name each placeholder. Choose the person when this template
                    is used.
                  </p>
                  {projectAssignees.map((assignee) => (
                    <label
                      key={assignee.employeeId}
                      className="grid gap-1 text-xs"
                    >
                      Tasks currently assigned to {assignee.name}
                      <input
                        aria-label={`Template role for ${assignee.name}`}
                        className="rounded border border-sand px-2 py-1.5 text-sm"
                        value={
                          projectTemplateRoleNames[assignee.employeeId] ??
                          assignee.name
                        }
                        onChange={(event) =>
                          setProjectTemplateRoleNames((current) => ({
                            ...current,
                            [assignee.employeeId]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  ))}
                </fieldset>
              ) : null}
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
                  <div className="mt-2 grid gap-2">
                    {templateRolesEnabled
                      ? template.rolePlaceholders.map((role) => (
                          <label
                            key={role.roleId}
                            className="grid gap-1 text-xs"
                          >
                            {role.name}
                            <select
                              aria-label={`${role.name} for ${template.name}`}
                              className="rounded border border-sand px-2 py-1 text-sm"
                              value={
                                templateRoleAssignments[
                                  `${template.templateId}:${role.roleId}`
                                ] ?? ""
                              }
                              onChange={(event) =>
                                setTemplateRoleAssignments((current) => ({
                                  ...current,
                                  [`${template.templateId}:${role.roleId}`]:
                                    event.target.value,
                                }))
                              }
                            >
                              <option value="">Leave unassigned</option>
                              {(employees.data ?? []).map((employee) => (
                                <option
                                  key={employee.employeeId}
                                  value={employee.employeeId}
                                >
                                  {employee.displayLabel}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))
                      : null}
                    <div className="flex gap-2">
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
                            referenceDate: new Date()
                              .toISOString()
                              .slice(0, 10),
                            roleAssignments: Object.fromEntries(
                              template.rolePlaceholders.map((role) => [
                                role.roleId,
                                templateRoleAssignments[
                                  `${template.templateId}:${role.roleId}`
                                ] || null,
                              ]),
                            ),
                          })
                        }
                      >
                        Use
                      </button>
                    </div>
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
            Package sections, fields, rules, custom task types, and task
            templates. Published changes update every installed project.
          </p>
          {publishBundle.data ? (
            <p className="mt-2 text-sm" role="status">
              Updated {publishBundle.data.rollout.updatedProjectCount} of{" "}
              {publishBundle.data.rollout.installedProjectCount} installed
              projects
              {publishBundle.data.rollout.failures.length
                ? `; ${publishBundle.data.rollout.failures.length} need attention.`
                : "."}
            </p>
          ) : null}
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
                <p
                  className={`mt-1 text-xs ${
                    (bundle.currentProjectCount ?? 0) <
                    (bundle.installedProjectCount ?? 0)
                      ? "text-amber-700"
                      : "text-muted"
                  }`}
                >
                  {bundle.currentProjectCount ?? 0} of{" "}
                  {bundle.installedProjectCount ?? 0} installed projects current
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
