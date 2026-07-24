"use client";

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { WorkNav } from "@/components/work-nav";
import { WorkLikeButton } from "@/components/work-like-button";
import { WorkProofingDialog } from "@/components/work-proofing-dialog";
import {
  WorkRichText,
  WorkRichTextEditor,
  type WorkMentionOption,
} from "@/components/work-rich-text";

type View = "list" | "board" | "calendar" | "timeline" | "files";
type EditableCustomTaskStatus = {
  statusOptionId?: string;
  name: string;
  color: string;
  completionState: "incomplete" | "complete";
  enabled: boolean;
};
type CustomTaskTypeAccessLevel = "admin" | "editor" | "user" | "none";

function canUseCustomTaskType(
  accessLevel: CustomTaskTypeAccessLevel,
  minimum: Exclude<CustomTaskTypeAccessLevel, "none"> = "user",
) {
  const rank = { none: 0, user: 1, editor: 2, admin: 3 } as const;
  return rank[accessLevel] >= rank[minimum];
}

function dateInputValue(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("File read failed"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

function isProofableAttachment(attachment: {
  name: string;
  contentType: string | null;
}) {
  return (
    [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/bmp",
    ].includes(attachment.contentType?.toLowerCase() ?? "") ||
    /\.(?:pdf|png|jpe?g|gif|bmp)$/i.test(attachment.name)
  );
}

export default function WorkPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const projects = trpc.work.projects.list.useQuery();
  const employees = trpc.work.members.listEmployees.useQuery(undefined, {
    retry: false,
  });
  const teams = trpc.work.members.listTeams.useQuery(undefined, {
    retry: false,
  });
  const [projectId, setProjectId] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [calendarMonth, setCalendarMonth] = useState(
    () =>
      new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
      ),
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectPrivacy, setProjectPrivacy] = useState<
    "organization" | "private"
  >("organization");
  const [sectionName, setSectionName] = useState("");
  const [quickTasks, setQuickTasks] = useState<Record<string, string>>({});
  const [headerTaskTitle, setHeaderTaskTitle] = useState("");
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(
    null,
  );
  const [comment, setComment] = useState("");
  const [subtask, setSubtask] = useState("");
  const [dependencyId, setDependencyId] = useState("");
  const [tagName, setTagName] = useState("");
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState<
    | "text"
    | "number"
    | "date"
    | "boolean"
    | "single_select"
    | "multi_select"
    | "people"
  >("text");
  const [fieldOptions, setFieldOptions] = useState("");
  const [customTaskTypeName, setCustomTaskTypeName] = useState("");
  const [customTaskTypeIcon, setCustomTaskTypeIcon] = useState("◆");
  const [customTaskIncompleteStatuses, setCustomTaskIncompleteStatuses] =
    useState("Backlog, In progress");
  const [customTaskCompleteStatus, setCustomTaskCompleteStatus] =
    useState("Done");
  const [customTaskTypeFilter, setCustomTaskTypeFilter] = useState("");
  const [customTaskStatusFilter, setCustomTaskStatusFilter] = useState("");
  const [sortByCustomTaskType, setSortByCustomTaskType] = useState(false);
  const [groupByCustomTaskType, setGroupByCustomTaskType] = useState(false);
  const [shareTargetProjectId, setShareTargetProjectId] = useState("");
  const [editingCustomTaskTypeId, setEditingCustomTaskTypeId] = useState<
    string | null
  >(null);
  const [accessCustomTaskTypeId, setAccessCustomTaskTypeId] = useState<
    string | null
  >(null);
  const [customTaskTypeMemberType, setCustomTaskTypeMemberType] = useState<
    "employee" | "team"
  >("employee");
  const [customTaskTypeMemberId, setCustomTaskTypeMemberId] = useState("");
  const [customTaskTypeMemberAccess, setCustomTaskTypeMemberAccess] = useState<
    "admin" | "editor" | "user"
  >("user");
  const [customTaskTypeEditName, setCustomTaskTypeEditName] = useState("");
  const [customTaskTypeEditIcon, setCustomTaskTypeEditIcon] = useState("");
  const [customTaskTypeEditStatuses, setCustomTaskTypeEditStatuses] = useState<
    EditableCustomTaskStatus[]
  >([]);
  const [attachmentName, setAttachmentName] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [proofingAttachment, setProofingAttachment] = useState<{
    attachmentId: string;
    name: string;
    contentType: string | null;
  } | null>(null);

  useEffect(() => {
    if (!projectId && projects.data?.[0])
      setProjectId(projects.data[0].projectId);
  }, [projectId, projects.data]);

  const detail = trpc.work.projects.get.useQuery(
    { projectId: projectId! },
    { enabled: Boolean(projectId) },
  );
  const selectedItem =
    detail.data?.items.find((item) => item.itemId === selectedItemId) ?? null;
  useEffect(() => {
    setDescriptionDraft(selectedItem?.description ?? "");
  }, [selectedItem?.description, selectedItem?.itemId]);
  const employeeById = useMemo(
    () =>
      new Map(
        (employees.data ?? []).map((employee) => [
          employee.employeeId,
          employee,
        ]),
      ),
    [employees.data],
  );
  const commentsEnabled =
    session.data?.enabledFeatureKeys.includes("work.comments") ?? false;
  const dependenciesEnabled =
    session.data?.enabledFeatureKeys.includes("work.dependencies") ?? false;
  const subtasksEnabled =
    session.data?.enabledFeatureKeys.includes("work.subtasks") ?? false;
  const sectionsEnabled =
    session.data?.enabledFeatureKeys.includes("work.sections") ?? false;
  const boardEnabled =
    session.data?.enabledFeatureKeys.includes("work.views.board") ?? false;
  const listEnabled =
    session.data?.enabledFeatureKeys.includes("work.views.list") ?? false;
  const calendarEnabled =
    session.data?.enabledFeatureKeys.includes("work.views.calendar") ?? false;
  const timelineEnabled =
    session.data?.enabledFeatureKeys.includes("work.views.timeline") ?? false;
  const filesViewEnabled =
    session.data?.enabledFeatureKeys.includes("work.views.files") ?? false;
  const followersEnabled =
    session.data?.enabledFeatureKeys.includes("work.followers") ?? false;
  const tagsEnabled =
    session.data?.enabledFeatureKeys.includes("work.tags") ?? false;
  const customFieldsEnabled =
    session.data?.enabledFeatureKeys.includes("work.custom_fields") ?? false;
  const customTaskTypesEnabled =
    session.data?.enabledFeatureKeys.includes("work.custom_task_types") ??
    false;
  const attachmentsEnabled =
    session.data?.enabledFeatureKeys.includes("work.attachments") ?? false;
  const proofingEnabled =
    session.data?.enabledFeatureKeys.includes("work.proofing") ?? false;
  const recurrenceEnabled =
    session.data?.enabledFeatureKeys.includes("work.recurring_tasks") ?? false;
  const timeEnabled =
    session.data?.enabledFeatureKeys.includes("work.time_tracking") ?? false;
  const richTextEnabled =
    session.data?.enabledFeatureKeys.includes("work.rich_text") ?? false;
  const comments = trpc.work.comments.list.useQuery(
    { itemId: selectedItemId! },
    { enabled: Boolean(selectedItemId && commentsEnabled) },
  );
  const followers = trpc.work.followers.list.useQuery(
    { itemId: selectedItemId! },
    { enabled: Boolean(selectedItemId && followersEnabled) },
  );
  const tags = trpc.work.tags.list.useQuery(
    { projectId: projectId! },
    { enabled: Boolean(projectId && tagsEnabled) },
  );
  const itemTags = trpc.work.tags.forTask.useQuery(
    { itemId: selectedItemId! },
    { enabled: Boolean(selectedItemId && tagsEnabled) },
  );
  const customFields = trpc.work.customFields.list.useQuery(
    { projectId: projectId! },
    { enabled: Boolean(projectId && customFieldsEnabled) },
  );
  const customFieldValues = trpc.work.customFields.values.useQuery(
    { itemId: selectedItemId! },
    { enabled: Boolean(selectedItemId && customFieldsEnabled) },
  );
  const customTaskTypes = trpc.work.customTaskTypes.list.useQuery(
    { projectId: projectId! },
    { enabled: Boolean(projectId && customTaskTypesEnabled) },
  );
  const customTaskAssignments = trpc.work.customTaskTypes.assignments.useQuery(
    { projectId: projectId! },
    { enabled: Boolean(projectId && customTaskTypesEnabled) },
  );
  const customTaskTypeAccess = trpc.work.customTaskTypes.access.useQuery(
    {
      projectId: projectId!,
      customTaskTypeId: accessCustomTaskTypeId!,
    },
    {
      enabled: Boolean(
        projectId && accessCustomTaskTypeId && customTaskTypesEnabled,
      ),
    },
  );
  const attachments = trpc.work.attachments.list.useQuery(
    { itemId: selectedItemId! },
    { enabled: Boolean(selectedItemId && attachmentsEnabled) },
  );
  const projectFiles = trpc.work.attachments.listProject.useQuery(
    { projectId: projectId! },
    { enabled: Boolean(projectId && filesViewEnabled && view === "files") },
  );

  const refreshProject = async () => {
    await Promise.all([
      utils.work.projects.list.invalidate(),
      utils.work.projects.get.invalidate(),
    ]);
  };
  const createProject = trpc.work.projects.create.useMutation({
    onSuccess: async (created) => {
      setProjectId(created.projectId);
      setProjectName("");
      setProjectDescription("");
      setNewProject(false);
      await refreshProject();
    },
  });
  const createSection = trpc.work.sections.create.useMutation({
    onSuccess: async () => {
      setSectionName("");
      await utils.work.projects.get.invalidate();
    },
  });
  const createTask = trpc.work.tasks.create.useMutation({
    onSuccess: async () => {
      setSubtask("");
      await Promise.all([
        utils.work.projects.get.invalidate(),
        utils.work.customTaskTypes.assignments.invalidate(),
      ]);
    },
  });
  const completeTask = trpc.work.tasks.complete.useMutation({
    onSuccess: () =>
      Promise.all([
        utils.work.projects.get.invalidate(),
        utils.work.customTaskTypes.assignments.invalidate(),
      ]),
  });
  const updateTask = trpc.work.tasks.update.useMutation({
    onSuccess: () => utils.work.projects.get.invalidate(),
  });
  const moveTask = trpc.work.tasks.move.useMutation({
    onSuccess: () => utils.work.projects.get.invalidate(),
  });
  const createComment = trpc.work.comments.create.useMutation({
    onSuccess: async () => {
      setComment("");
      await utils.work.comments.list.invalidate();
    },
  });
  const addDependency = trpc.work.dependencies.add.useMutation({
    onSuccess: async () => {
      setDependencyId("");
      await utils.work.projects.get.invalidate();
    },
  });
  const removeDependency = trpc.work.dependencies.remove.useMutation({
    onSuccess: () => utils.work.projects.get.invalidate(),
  });
  const follow = trpc.work.followers.follow.useMutation({
    onSuccess: () => utils.work.followers.list.invalidate(),
  });
  const unfollow = trpc.work.followers.unfollow.useMutation({
    onSuccess: () => utils.work.followers.list.invalidate(),
  });
  const createTag = trpc.work.tags.create.useMutation({
    onSuccess: async () => {
      setTagName("");
      await utils.work.tags.list.invalidate();
    },
  });
  const setTags = trpc.work.tags.setForTask.useMutation({
    onSuccess: () => utils.work.tags.forTask.invalidate(),
  });
  const createCustomField = trpc.work.customFields.create.useMutation({
    onSuccess: async () => {
      setFieldName("");
      setFieldOptions("");
      await utils.work.customFields.list.invalidate();
    },
  });
  const setCustomField = trpc.work.customFields.setValue.useMutation({
    onSuccess: () => utils.work.customFields.values.invalidate(),
  });
  const createCustomTaskType = trpc.work.customTaskTypes.create.useMutation({
    onSuccess: async () => {
      setCustomTaskTypeName("");
      await utils.work.customTaskTypes.list.invalidate();
    },
  });
  const setCustomTaskType = trpc.work.customTaskTypes.setForTask.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.customTaskTypes.assignments.invalidate(),
        utils.work.projects.get.invalidate(),
      ]);
    },
  });
  const setDefaultCustomTaskType =
    trpc.work.customTaskTypes.setDefault.useMutation({
      onSuccess: () => utils.work.customTaskTypes.list.invalidate(),
    });
  const shareCustomTaskType = trpc.work.customTaskTypes.share.useMutation({
    onSuccess: () => utils.work.customTaskTypes.list.invalidate(),
  });
  const updateCustomTaskType = trpc.work.customTaskTypes.update.useMutation({
    onSuccess: async () => {
      setEditingCustomTaskTypeId(null);
      await Promise.all([
        utils.work.customTaskTypes.list.invalidate(),
        utils.work.customTaskTypes.assignments.invalidate(),
        utils.work.projects.get.invalidate(),
      ]);
    },
  });
  const removeCustomTaskTypeFromProject =
    trpc.work.customTaskTypes.removeFromProject.useMutation({
      onSuccess: () => utils.work.customTaskTypes.list.invalidate(),
    });
  const setCustomTaskTypeDefaultAccess =
    trpc.work.customTaskTypes.setDefaultAccess.useMutation({
      onSuccess: () =>
        Promise.all([
          utils.work.customTaskTypes.access.invalidate(),
          utils.work.customTaskTypes.list.invalidate(),
        ]),
    });
  const updateCustomTaskTypeMemberAccess =
    trpc.work.customTaskTypes.setMemberAccess.useMutation({
      onSuccess: async () => {
        setCustomTaskTypeMemberId("");
        await Promise.all([
          utils.work.customTaskTypes.access.invalidate(),
          utils.work.customTaskTypes.list.invalidate(),
        ]);
      },
    });
  const addAttachmentLink = trpc.work.attachments.addLink.useMutation({
    onSuccess: async () => {
      setAttachmentName("");
      setAttachmentUrl("");
      await Promise.all([
        utils.work.attachments.list.invalidate(),
        utils.work.attachments.listProject.invalidate(),
      ]);
    },
  });
  const uploadAttachment = trpc.work.attachments.upload.useMutation({
    onSuccess: () => utils.work.attachments.invalidate(),
  });
  const openAttachment = trpc.work.attachments.open.useMutation();
  const removeAttachment = trpc.work.attachments.remove.useMutation({
    onSuccess: () => utils.work.attachments.invalidate(),
  });
  const setRecurrence = trpc.work.recurrence.set.useMutation({
    onSuccess: () => utils.work.projects.get.invalidate(),
  });

  const sections = detail.data?.sections ?? [];
  const boardSections: Array<{ sectionId: string | null; name: string }> = [
    { sectionId: null, name: "No section" },
    ...sections,
  ];
  const items = detail.data?.items ?? [];
  const mentionOptions = useMemo<WorkMentionOption[]>(
    () => [
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
      ...items.map((item) => ({
        id: item.itemId,
        label: item.title,
        type: "task" as const,
      })),
    ],
    [employees.data, items, projects.data],
  );
  const customTaskAssignmentByItem = useMemo(
    () =>
      new Map(
        (customTaskAssignments.data ?? []).map((assignment) => [
          assignment.itemId,
          assignment,
        ]),
      ),
    [customTaskAssignments.data],
  );
  const topLevelItems = useMemo(() => {
    const filtered = items.filter((item) => {
      if (item.parentItemId) return false;
      const assignment = customTaskAssignmentByItem.get(item.itemId);
      return (
        (!customTaskTypeFilter ||
          assignment?.customTaskTypeId === customTaskTypeFilter) &&
        (!customTaskStatusFilter ||
          assignment?.statusOptionId === customTaskStatusFilter)
      );
    });
    return sortByCustomTaskType
      ? filtered.sort((a, b) => {
          const left = customTaskAssignmentByItem.get(a.itemId);
          const right = customTaskAssignmentByItem.get(b.itemId);
          return `${left?.typeName ?? ""}:${left?.statusName ?? ""}`.localeCompare(
            `${right?.typeName ?? ""}:${right?.statusName ?? ""}`,
          );
        })
      : filtered;
  }, [
    customTaskAssignmentByItem,
    customTaskStatusFilter,
    customTaskTypeFilter,
    items,
    sortByCustomTaskType,
  ]);
  const canEdit = ["admin", "editor"].includes(
    detail.data?.project.accessLevel ?? "viewer",
  );
  const canComment =
    canEdit || detail.data?.project.accessLevel === "commenter";
  const dependencies = useMemo(
    () =>
      new Map(
        items.map((item) => [
          item.itemId,
          (detail.data?.dependencies ?? [])
            .filter((dependency) => dependency.itemId === item.itemId)
            .map((dependency) => dependency.dependsOnItemId),
        ]),
      ),
    [detail.data?.dependencies, items],
  );
  const selectedTagIds = new Set((itemTags.data ?? []).map((tag) => tag.tagId));
  const selectedFieldValues = new Map(
    (customFieldValues.data ?? []).map((entry) => [
      entry.customFieldId,
      entry.value,
    ]),
  );
  const selectedCustomTaskAssignment = selectedItemId
    ? customTaskAssignmentByItem.get(selectedItemId)
    : undefined;
  const selectedCustomTaskType = (customTaskTypes.data ?? []).find(
    (type) =>
      type.customTaskTypeId === selectedCustomTaskAssignment?.customTaskTypeId,
  );
  const listGroups = groupByCustomTaskType
    ? [
        {
          id: "standard",
          name: "Standard tasks",
          sectionId: null,
          items: topLevelItems.filter(
            (item) =>
              !customTaskAssignmentByItem.get(item.itemId)?.customTaskTypeId,
          ),
          quickAdd: false,
        },
        ...(customTaskTypes.data ?? []).map((type) => ({
          id: type.customTaskTypeId,
          name: `${type.icon} ${type.name}`,
          sectionId: null,
          items: topLevelItems.filter(
            (item) =>
              customTaskAssignmentByItem.get(item.itemId)?.customTaskTypeId ===
              type.customTaskTypeId,
          ),
          quickAdd: false,
        })),
      ]
    : sections.map((section) => ({
        id: section.sectionId,
        name: section.name,
        sectionId: section.sectionId,
        items: topLevelItems.filter(
          (item) => item.sectionId === section.sectionId,
        ),
        quickAdd: true,
      }));
  const calendarDays = useMemo(() => {
    const first = new Date(calendarMonth);
    first.setUTCDate(first.getUTCDate() - first.getUTCDay());
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(first);
      day.setUTCDate(day.getUTCDate() + index);
      return day;
    });
  }, [calendarMonth]);
  const timelineRange = useMemo(() => {
    const dates = topLevelItems.flatMap((item) =>
      [item.startDate, item.dueAt].flatMap((value) =>
        value ? [new Date(value).getTime()] : [],
      ),
    );
    const min = dates.length ? Math.min(...dates) : Date.now();
    const max = dates.length ? Math.max(...dates) : min + 86_400_000;
    return { min, span: Math.max(86_400_000, max - min) };
  }, [topLevelItems]);
  const mutationError =
    createProject.error ??
    createSection.error ??
    createTask.error ??
    completeTask.error ??
    updateTask.error ??
    moveTask.error ??
    createComment.error ??
    addDependency.error ??
    removeDependency.error ??
    follow.error ??
    unfollow.error ??
    createTag.error ??
    setTags.error ??
    createCustomField.error ??
    setCustomField.error ??
    createCustomTaskType.error ??
    setCustomTaskType.error ??
    setDefaultCustomTaskType.error ??
    shareCustomTaskType.error ??
    updateCustomTaskType.error ??
    removeCustomTaskTypeFromProject.error ??
    addAttachmentLink.error ??
    uploadAttachment.error ??
    openAttachment.error ??
    removeAttachment.error ??
    setRecurrence.error;

  function addQuickTask(sectionId: string | null) {
    if (!projectId) return;
    const key = sectionId ?? "none";
    const title = quickTasks[key]?.trim();
    if (!title) return;
    createTask.mutate({ projectId, sectionId, title, description: "" });
    setQuickTasks((current) => ({ ...current, [key]: "" }));
  }

  function moveDraggedTask(sectionId: string | null) {
    if (!projectId || !dragItemId || !canEdit) return;
    const item = items.find((candidate) => candidate.itemId === dragItemId);
    if (!item || item.sectionId === sectionId) return;
    moveTask.mutate({
      itemId: item.itemId,
      projectId,
      sectionId,
      position: topLevelItems.filter(
        (candidate) => candidate.sectionId === sectionId,
      ).length,
    });
  }

  function taskRow(item: (typeof items)[number]) {
    const blockedBy = dependencies.get(item.itemId) ?? [];
    const customTaskAssignment = customTaskAssignmentByItem.get(item.itemId);
    const blocked = blockedBy.some(
      (id) => !items.find((candidate) => candidate.itemId === id)?.completedAt,
    );
    return (
      <div
        key={item.itemId}
        className={`grid cursor-pointer gap-3 border-b border-sand/70 px-3 py-2.5 last:border-b-0 md:grid-cols-[auto_minmax(12rem,1fr)_10rem_9rem_8rem] md:items-center ${item.completedAt ? "bg-zinc-50 text-muted" : "bg-white/60"}`}
        onClick={() => setSelectedItemId(item.itemId)}
      >
        <input
          type="checkbox"
          aria-label={`Complete ${item.title}`}
          checked={Boolean(item.completedAt)}
          disabled={!canEdit || completeTask.isPending}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) =>
            completeTask.mutate({
              itemId: item.itemId,
              completed: event.target.checked,
            })
          }
          className="h-4 w-4 accent-[var(--ochre)]"
        />
        <div className="min-w-0">
          <p
            className={`truncate text-sm font-medium ${item.completedAt ? "line-through" : ""}`}
          >
            {item.title}
          </p>
          <div className="mt-0.5 flex gap-2 text-[10px] uppercase tracking-[0.08em] text-muted">
            {item.itemType !== "task" ? <span>{item.itemType}</span> : null}
            {customTaskAssignment?.typeName ? (
              <span>
                {customTaskAssignment.typeIcon} {customTaskAssignment.typeName}
              </span>
            ) : null}
            {customTaskAssignment?.statusName ? (
              <span
                style={{ color: customTaskAssignment.statusColor ?? undefined }}
              >
                {customTaskAssignment.statusName}
              </span>
            ) : null}
            {blocked ? <span className="text-red-700">Blocked</span> : null}
            {items.some(
              (candidate) => candidate.parentItemId === item.itemId,
            ) ? (
              <span>
                {
                  items.filter(
                    (candidate) => candidate.parentItemId === item.itemId,
                  ).length
                }{" "}
                subtasks
              </span>
            ) : null}
          </div>
        </div>
        <span className="truncate text-xs text-muted">
          {employeeById.get(item.assigneeEmployeeId ?? "")?.displayLabel ??
            item.assigneeName ??
            "Unassigned"}
        </span>
        <span className="text-xs text-muted">
          {item.dueAt
            ? new Date(item.dueAt).toLocaleDateString()
            : "No due date"}
        </span>
        <span
          className={`w-fit rounded-full px-2 py-1 text-[10px] font-bold uppercase ${item.priority === "urgent" ? "bg-red-100 text-red-800" : item.priority === "high" ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-600"}`}
        >
          {item.priority ?? "normal"}
        </span>
      </div>
    );
  }

  return (
    <main className="flex flex-col gap-5">
      <WorkNav />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
            Work management
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">
            Projects & tasks
          </h1>
          <p className="mt-2 text-sm text-muted">
            One work graph for native hrmny projects and imported Asana work.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {projectId && canEdit ? (
            <form
              className="flex"
              onSubmit={(event) => {
                event.preventDefault();
                const title = headerTaskTitle.trim();
                if (!title) return;
                createTask.mutate({
                  projectId,
                  sectionId: sections[0]?.sectionId ?? null,
                  title,
                  description: "",
                });
                setHeaderTaskTitle("");
              }}
            >
              <input
                aria-label="New task title"
                className="rounded-l-full border border-sand bg-white px-4 py-2 text-sm"
                placeholder="Task title"
                value={headerTaskTitle}
                onChange={(event) => setHeaderTaskTitle(event.target.value)}
              />
              <button
                className="rounded-r-full bg-ochre px-4 py-2 text-sm font-medium text-white"
                disabled={!headerTaskTitle.trim() || createTask.isPending}
              >
                + Add task
              </button>
            </form>
          ) : null}
          <button
            type="button"
            className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white"
            onClick={() => setNewProject((value) => !value)}
          >
            + New project
          </button>
        </div>
      </header>

      {mutationError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {mutationError.message}
        </p>
      ) : null}

      {newProject ? (
        <form
          className="grid gap-3 rounded-xl border border-sand bg-white/75 p-4 md:grid-cols-[1fr_12rem_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            createProject.mutate({
              name: projectName,
              description: projectDescription,
              privacy: projectPrivacy,
            });
          }}
        >
          <input
            className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
            placeholder="Project name"
            required
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
          />
          <select
            className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
            value={projectPrivacy}
            onChange={(event) =>
              setProjectPrivacy(event.target.value as typeof projectPrivacy)
            }
          >
            <option value="organization">Organization</option>
            <option value="private">Private</option>
          </select>
          <button
            className="rounded-lg bg-ochre px-4 py-2 text-sm font-medium text-white"
            disabled={!projectName.trim() || createProject.isPending}
          >
            Create
          </button>
          <div className="md:col-span-3">
            {richTextEnabled ? (
              <WorkRichTextEditor
                ariaLabel="Project description"
                maxLength={20_000}
                mentions={mentionOptions}
                placeholder="Project description (optional)"
                value={projectDescription}
                onChange={setProjectDescription}
              />
            ) : (
              <textarea
                aria-label="Project description"
                className="min-h-20 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm"
                maxLength={20_000}
                placeholder="Project description (optional)"
                value={projectDescription}
                onChange={(event) => setProjectDescription(event.target.value)}
              />
            )}
          </div>
        </form>
      ) : null}

      <div className="grid min-h-[36rem] overflow-hidden rounded-xl border border-sand bg-white/60 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="border-b border-sand bg-[var(--paper)] p-3 xl:border-b-0 xl:border-r">
          <p className="px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
            Projects
          </p>
          <div className="mt-2 flex gap-2 overflow-x-auto xl:flex-col">
            {(projects.data ?? []).map((project) => (
              <button
                key={project.projectId}
                type="button"
                className={`min-w-48 rounded-lg px-3 py-2 text-left text-sm xl:min-w-0 ${projectId === project.projectId ? "bg-white font-medium shadow-sm" : "hover:bg-white/70"}`}
                onClick={() => {
                  setProjectId(project.projectId);
                  setSelectedItemId(null);
                }}
              >
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: project.color }}
                />
                {project.name}
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 p-4">
          {detail.isLoading ? (
            <p className="text-sm text-muted">Loading project…</p>
          ) : detail.data ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-sand pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="h-4 w-4 rounded"
                      style={{ background: detail.data.project.color }}
                    />
                    <h2 className="font-display text-2xl font-semibold">
                      {detail.data.project.name}
                    </h2>
                  </div>
                  {richTextEnabled && detail.data.project.description ? (
                    <WorkRichText
                      className="mt-1 text-sm text-muted"
                      value={detail.data.project.description}
                    />
                  ) : (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted">
                      {detail.data.project.description ||
                        "No project description yet."}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                    {detail.data.project.privacy} ·{" "}
                    {detail.data.project.accessLevel}
                  </p>
                </div>
                <div className="flex rounded-full border border-sand bg-white p-1 text-xs">
                  {listEnabled ? (
                    <button
                      type="button"
                      className={`rounded-full px-3 py-1.5 ${view === "list" ? "bg-ink text-white" : ""}`}
                      onClick={() => setView("list")}
                    >
                      List
                    </button>
                  ) : null}
                  {boardEnabled ? (
                    <button
                      type="button"
                      className={`rounded-full px-3 py-1.5 ${view === "board" ? "bg-ink text-white" : ""}`}
                      onClick={() => setView("board")}
                    >
                      Board
                    </button>
                  ) : null}
                  {calendarEnabled ? (
                    <button
                      type="button"
                      className={`rounded-full px-3 py-1.5 ${view === "calendar" ? "bg-ink text-white" : ""}`}
                      onClick={() => setView("calendar")}
                    >
                      Calendar
                    </button>
                  ) : null}
                  {timelineEnabled ? (
                    <button
                      type="button"
                      className={`rounded-full px-3 py-1.5 ${view === "timeline" ? "bg-ink text-white" : ""}`}
                      onClick={() => setView("timeline")}
                    >
                      Timeline
                    </button>
                  ) : null}
                  {filesViewEnabled ? (
                    <button
                      type="button"
                      className={`rounded-full px-3 py-1.5 ${view === "files" ? "bg-ink text-white" : ""}`}
                      onClick={() => setView("files")}
                    >
                      Files
                    </button>
                  ) : null}
                </div>
              </div>

              {customTaskTypesEnabled ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-sand bg-white/70 p-2 text-xs">
                  <label>
                    <span className="sr-only">Filter by task type</span>
                    <select
                      className="rounded border border-sand bg-white px-2 py-1.5"
                      value={customTaskTypeFilter}
                      onChange={(event) => {
                        setCustomTaskTypeFilter(event.target.value);
                        setCustomTaskStatusFilter("");
                      }}
                    >
                      <option value="">All task types</option>
                      {(customTaskTypes.data ?? [])
                        .filter(
                          (type) =>
                            type.isAssociated ||
                            type.customTaskTypeId ===
                              selectedCustomTaskAssignment?.customTaskTypeId,
                        )
                        .map((type) => (
                          <option
                            key={type.customTaskTypeId}
                            value={type.customTaskTypeId}
                          >
                            {type.icon} {type.name}
                            {!type.isAssociated ? " (task only)" : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">Filter by task status</span>
                    <select
                      className="rounded border border-sand bg-white px-2 py-1.5"
                      value={customTaskStatusFilter}
                      onChange={(event) =>
                        setCustomTaskStatusFilter(event.target.value)
                      }
                    >
                      <option value="">All statuses</option>
                      {(customTaskTypes.data ?? [])
                        .filter(
                          (type) =>
                            !customTaskTypeFilter ||
                            type.customTaskTypeId === customTaskTypeFilter,
                        )
                        .flatMap((type) =>
                          type.statuses
                            .filter((status) => status.enabled)
                            .map((status) => (
                              <option
                                key={status.statusOptionId}
                                value={status.statusOptionId}
                              >
                                {type.name}: {status.name}
                              </option>
                            )),
                        )}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={sortByCustomTaskType}
                      onChange={(event) =>
                        setSortByCustomTaskType(event.target.checked)
                      }
                    />
                    Sort by type
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={groupByCustomTaskType}
                      onChange={(event) =>
                        setGroupByCustomTaskType(event.target.checked)
                      }
                    />
                    Group by type
                  </label>
                </div>
              ) : null}

              {view === "board" && boardEnabled ? (
                <div className="mt-4 flex gap-4 overflow-x-auto pb-4">
                  {boardSections.map((section) => {
                    const sectionItems = topLevelItems.filter(
                      (item) => item.sectionId === section.sectionId,
                    );
                    const sectionKey = section.sectionId ?? "none";
                    return (
                      <div
                        key={sectionKey}
                        className={`w-72 shrink-0 rounded-xl border p-3 ${dragOverSectionId === sectionKey ? "border-ochre bg-ochre/10" : "border-transparent bg-[var(--paper)]"}`}
                        onDragEnter={() => setDragOverSectionId(sectionKey)}
                        onDragLeave={(event) => {
                          if (
                            !event.currentTarget.contains(
                              event.relatedTarget as Node,
                            )
                          )
                            setDragOverSectionId(null);
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          moveDraggedTask(section.sectionId);
                          setDragItemId(null);
                          setDragOverSectionId(null);
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold">
                            {section.name}
                          </h3>
                          <span className="text-xs text-muted">
                            {sectionItems.length}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-col gap-2">
                          {sectionItems.map((item) => (
                            <button
                              key={item.itemId}
                              type="button"
                              draggable={canEdit}
                              className="cursor-grab rounded-lg border border-sand bg-white p-3 text-left shadow-sm active:cursor-grabbing"
                              onDragStart={(event) => {
                                setDragItemId(item.itemId);
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData(
                                  "text/plain",
                                  item.itemId,
                                );
                              }}
                              onDragEnd={() => {
                                setDragItemId(null);
                                setDragOverSectionId(null);
                              }}
                              onClick={() => setSelectedItemId(item.itemId)}
                            >
                              <p
                                className={`text-sm font-medium ${item.completedAt ? "line-through text-muted" : ""}`}
                              >
                                {item.title}
                              </p>
                              <div className="mt-3 flex items-center justify-between text-[10px] text-muted">
                                <span>
                                  {employeeById.get(
                                    item.assigneeEmployeeId ?? "",
                                  )?.displayLabel ??
                                    item.assigneeName ??
                                    "Unassigned"}
                                </span>
                                <span>
                                  {item.dueAt
                                    ? new Date(item.dueAt).toLocaleDateString()
                                    : ""}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                        {canEdit ? (
                          <form
                            className="mt-2"
                            onSubmit={(event) => {
                              event.preventDefault();
                              addQuickTask(section.sectionId);
                            }}
                          >
                            <input
                              className="w-full rounded-lg border border-dashed border-sand bg-white/70 px-3 py-2 text-sm"
                              placeholder="+ Add task"
                              value={quickTasks[sectionKey] ?? ""}
                              onChange={(event) =>
                                setQuickTasks((current) => ({
                                  ...current,
                                  [sectionKey]: event.target.value,
                                }))
                              }
                            />
                          </form>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : view === "calendar" && calendarEnabled ? (
                <section className="mt-4 overflow-hidden rounded-xl border border-sand bg-white/70">
                  <div className="flex items-center justify-between border-b border-sand p-3">
                    <button
                      type="button"
                      className="rounded border border-sand px-2 py-1"
                      onClick={() =>
                        setCalendarMonth(
                          new Date(
                            Date.UTC(
                              calendarMonth.getUTCFullYear(),
                              calendarMonth.getUTCMonth() - 1,
                              1,
                            ),
                          ),
                        )
                      }
                    >
                      ←
                    </button>
                    <h3 className="font-display text-lg">
                      {calendarMonth.toLocaleDateString(undefined, {
                        month: "long",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                    </h3>
                    <button
                      type="button"
                      className="rounded border border-sand px-2 py-1"
                      onClick={() =>
                        setCalendarMonth(
                          new Date(
                            Date.UTC(
                              calendarMonth.getUTCFullYear(),
                              calendarMonth.getUTCMonth() + 1,
                              1,
                            ),
                          ),
                        )
                      }
                    >
                      →
                    </button>
                  </div>
                  <div className="grid grid-cols-7 border-b border-sand bg-[var(--paper)] text-center text-[10px] font-bold uppercase text-muted">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                      (day) => (
                        <div key={day} className="p-2">
                          {day}
                        </div>
                      ),
                    )}
                  </div>
                  <div className="grid grid-cols-7">
                    {calendarDays.map((day) => {
                      const key = day.toISOString().slice(0, 10);
                      const dayTasks = topLevelItems.filter(
                        (item) => item.dueAt?.slice(0, 10) === key,
                      );
                      return (
                        <div
                          key={key}
                          className={`min-h-24 border-b border-r border-sand p-1 ${day.getUTCMonth() === calendarMonth.getUTCMonth() ? "bg-white/60" : "bg-zinc-50 text-muted"}`}
                        >
                          <span className="px-1 text-xs">
                            {day.getUTCDate()}
                          </span>
                          <div className="mt-1 space-y-1">
                            {dayTasks.slice(0, 4).map((item) => (
                              <button
                                key={item.itemId}
                                type="button"
                                className="block w-full truncate rounded bg-amber-100 px-1.5 py-1 text-left text-[10px] text-amber-950"
                                onClick={() => setSelectedItemId(item.itemId)}
                              >
                                {item.title}
                              </button>
                            ))}
                            {dayTasks.length > 4 ? (
                              <p className="px-1 text-[10px] text-muted">
                                +{dayTasks.length - 4} more
                              </p>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : view === "timeline" && timelineEnabled ? (
                <section className="mt-4 overflow-x-auto rounded-xl border border-sand bg-white/70 p-4">
                  <div className="min-w-[48rem] space-y-3">
                    {topLevelItems.map((item) => {
                      const start = item.startDate
                        ? new Date(item.startDate).getTime()
                        : item.dueAt
                          ? new Date(item.dueAt).getTime()
                          : timelineRange.min;
                      const end = item.dueAt
                        ? new Date(item.dueAt).getTime()
                        : start;
                      const left =
                        ((start - timelineRange.min) / timelineRange.span) *
                        100;
                      const width = Math.max(
                        2,
                        ((Math.max(start, end) - start) / timelineRange.span) *
                          100,
                      );
                      return (
                        <button
                          key={item.itemId}
                          type="button"
                          className="grid w-full grid-cols-[14rem_1fr] items-center gap-3 text-left"
                          onClick={() => setSelectedItemId(item.itemId)}
                        >
                          <span className="truncate text-sm font-medium">
                            {item.title}
                          </span>
                          <span className="relative h-7 rounded bg-zinc-100">
                            <span
                              className="absolute top-1 h-5 rounded bg-ochre"
                              style={{
                                left: `${Math.max(0, Math.min(98, left))}%`,
                                width: `${Math.min(100 - left, width)}%`,
                              }}
                            />
                          </span>
                        </button>
                      );
                    })}
                    {!topLevelItems.length ? (
                      <p className="text-sm text-muted">No scheduled tasks.</p>
                    ) : null}
                  </div>
                </section>
              ) : view === "files" && filesViewEnabled ? (
                <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {(projectFiles.data ?? []).map((file) => (
                    <button
                      key={file.attachmentId}
                      type="button"
                      className="rounded-xl border border-sand bg-white p-4 text-left"
                      onClick={() =>
                        void openAttachment
                          .mutateAsync({ attachmentId: file.attachmentId })
                          .then((result) =>
                            window.open(
                              result.url,
                              "_blank",
                              "noopener,noreferrer",
                            ),
                          )
                      }
                    >
                      <span className="text-2xl">📎</span>
                      <p className="mt-3 truncate font-medium">{file.name}</p>
                      <p className="mt-1 truncate text-xs text-muted">
                        {"taskTitle" in file
                          ? String(file.taskTitle)
                          : "Task attachment"}
                      </p>
                    </button>
                  ))}
                  {!projectFiles.isLoading && !projectFiles.data?.length ? (
                    <p className="text-sm text-muted">No project files yet.</p>
                  ) : null}
                </section>
              ) : (
                <div className="mt-4 flex flex-col gap-4">
                  {listGroups.map((group) => {
                    return (
                      <section
                        key={group.id}
                        className="overflow-hidden rounded-lg border border-sand"
                      >
                        <div className="flex items-center justify-between bg-[var(--paper)] px-3 py-2">
                          <h3 className="text-xs font-bold uppercase tracking-[0.1em]">
                            {group.name}
                          </h3>
                          <span className="text-xs text-muted">
                            {group.items.length}
                          </span>
                        </div>
                        {group.items.map(taskRow)}
                        {canEdit && group.quickAdd ? (
                          <form
                            className="border-t border-sand bg-white/50 p-2"
                            onSubmit={(event) => {
                              event.preventDefault();
                              addQuickTask(group.sectionId);
                            }}
                          >
                            <input
                              className="w-full bg-transparent px-2 py-1 text-sm outline-none"
                              placeholder="+ Add task"
                              value={quickTasks[group.sectionId!] ?? ""}
                              onChange={(event) =>
                                setQuickTasks((current) => ({
                                  ...current,
                                  [group.sectionId!]: event.target.value,
                                }))
                              }
                            />
                          </form>
                        ) : null}
                      </section>
                    );
                  })}
                  {sectionsEnabled && canEdit && !groupByCustomTaskType ? (
                    <form
                      className="flex gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (projectId)
                          createSection.mutate({
                            projectId,
                            name: sectionName,
                          });
                      }}
                    >
                      <input
                        className="min-w-0 flex-1 rounded-lg border border-dashed border-sand bg-white/60 px-3 py-2 text-sm"
                        placeholder="New section"
                        value={sectionName}
                        onChange={(event) => setSectionName(event.target.value)}
                      />
                      <button
                        className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
                        disabled={!sectionName.trim()}
                      >
                        Add section
                      </button>
                    </form>
                  ) : null}
                </div>
              )}
            </>
          ) : (
            <div className="flex min-h-80 items-center justify-center text-sm text-muted">
              Create or select a project.
            </div>
          )}
        </section>
      </div>

      {selectedItem ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/20"
          role="dialog"
          aria-modal="true"
          aria-label={selectedItem.title}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedItemId(null);
          }}
        >
          <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-sand bg-[var(--paper)] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <input
                  type="checkbox"
                  checked={Boolean(selectedItem.completedAt)}
                  disabled={!canEdit}
                  onChange={(event) =>
                    completeTask.mutate({
                      itemId: selectedItem.itemId,
                      completed: event.target.checked,
                    })
                  }
                  className="mt-1 h-5 w-5 accent-[var(--ochre)]"
                />
                <div>
                  <h2 className="font-display text-2xl font-semibold">
                    {selectedItem.title}
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    {detail.data?.project.name}
                  </p>
                  <div className="mt-2">
                    <WorkLikeButton
                      targetType="item"
                      targetId={selectedItem.itemId}
                    />
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="rounded-full border border-sand bg-white px-3 py-1.5 text-sm"
                onClick={() => setSelectedItemId(null)}
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                Assignee
                <select
                  className="mt-1 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                  value={selectedItem.assigneeEmployeeId ?? ""}
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateTask.mutate({
                      itemId: selectedItem.itemId,
                      assigneeEmployeeId: event.target.value || null,
                    })
                  }
                >
                  <option value="">Unassigned</option>
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
              <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                Due date
                <input
                  className="mt-1 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                  type="date"
                  value={dateInputValue(selectedItem.dueAt)}
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateTask.mutate({
                      itemId: selectedItem.itemId,
                      dueAt: event.target.value
                        ? new Date(
                            `${event.target.value}T17:00:00.000Z`,
                          ).toISOString()
                        : null,
                    })
                  }
                />
              </label>
              <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                Priority
                <select
                  className="mt-1 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                  value={selectedItem.priority ?? ""}
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateTask.mutate({
                      itemId: selectedItem.itemId,
                      priority: (event.target.value ||
                        null) as typeof selectedItem.priority,
                    })
                  }
                >
                  <option value="">Normal</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              {customTaskTypesEnabled && selectedItem.itemType === "task" ? (
                <>
                  <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                    Task type
                    <select
                      className="mt-1 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                      value={
                        selectedCustomTaskAssignment?.customTaskTypeId ?? ""
                      }
                      disabled={!canEdit}
                      onChange={(event) => {
                        const type = (customTaskTypes.data ?? []).find(
                          (candidate) =>
                            candidate.customTaskTypeId === event.target.value,
                        );
                        const status = type?.statuses.find(
                          (candidate) =>
                            candidate.enabled &&
                            candidate.completionState === "incomplete",
                        );
                        if (projectId)
                          setCustomTaskType.mutate({
                            projectId,
                            itemId: selectedItem.itemId,
                            customTaskTypeId: type?.customTaskTypeId ?? null,
                            statusOptionId: status?.statusOptionId ?? null,
                          });
                      }}
                    >
                      <option value="">Standard task</option>
                      {(customTaskTypes.data ?? [])
                        .filter(
                          (type) =>
                            (type.isAssociated &&
                              canUseCustomTaskType(type.accessLevel)) ||
                            type.customTaskTypeId ===
                              selectedCustomTaskAssignment?.customTaskTypeId,
                        )
                        .map((type) => (
                          <option
                            key={type.customTaskTypeId}
                            value={type.customTaskTypeId}
                          >
                            {type.icon} {type.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                    Type status
                    <select
                      className="mt-1 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                      value={selectedCustomTaskAssignment?.statusOptionId ?? ""}
                      disabled={
                        !canEdit ||
                        !selectedCustomTaskAssignment?.customTaskTypeId ||
                        !selectedCustomTaskType ||
                        !canUseCustomTaskType(
                          selectedCustomTaskType.accessLevel,
                        )
                      }
                      onChange={(event) => {
                        if (
                          projectId &&
                          selectedCustomTaskAssignment?.customTaskTypeId
                        )
                          setCustomTaskType.mutate({
                            projectId,
                            itemId: selectedItem.itemId,
                            customTaskTypeId:
                              selectedCustomTaskAssignment.customTaskTypeId,
                            statusOptionId: event.target.value,
                          });
                      }}
                    >
                      <option value="">Choose status</option>
                      {(customTaskTypes.data ?? [])
                        .find(
                          (type) =>
                            type.customTaskTypeId ===
                            selectedCustomTaskAssignment?.customTaskTypeId,
                        )
                        ?.statuses.filter((status) => status.enabled)
                        .map((status) => (
                          <option
                            key={status.statusOptionId}
                            value={status.statusOptionId}
                          >
                            {status.name}
                            {status.completionState === "complete"
                              ? " (complete)"
                              : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              ) : null}
              {timeEnabled ? (
                <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                  Estimated minutes
                  <input
                    className="mt-1 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                    type="number"
                    min="1"
                    max="1000000"
                    value={selectedItem.estimatedMinutes ?? ""}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateTask.mutate({
                        itemId: selectedItem.itemId,
                        estimatedMinutes: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                  />
                </label>
              ) : null}
              <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                Section
                <select
                  className="mt-1 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                  value={selectedItem.sectionId ?? ""}
                  disabled={!canEdit}
                  onChange={(event) =>
                    projectId &&
                    moveTask.mutate({
                      itemId: selectedItem.itemId,
                      projectId,
                      sectionId: event.target.value || null,
                      position: selectedItem.position,
                    })
                  }
                >
                  <option value="">No section</option>
                  {sections.map((section) => (
                    <option key={section.sectionId} value={section.sectionId}>
                      {section.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-5 text-xs font-bold uppercase tracking-[0.1em] text-muted">
              Description
              {richTextEnabled && canEdit ? (
                <WorkRichTextEditor
                  ariaLabel="Task description"
                  className="mt-1 font-normal normal-case tracking-normal text-ink"
                  maxLength={20_000}
                  mentions={mentionOptions}
                  value={descriptionDraft}
                  onChange={setDescriptionDraft}
                  onBlur={() => {
                    if (descriptionDraft !== selectedItem.description)
                      updateTask.mutate({
                        itemId: selectedItem.itemId,
                        description: descriptionDraft,
                      });
                  }}
                />
              ) : richTextEnabled ? (
                <WorkRichText
                  className="mt-1 rounded-lg border border-sand bg-white p-3 text-sm font-normal normal-case tracking-normal text-ink"
                  value={selectedItem.description}
                />
              ) : (
                <textarea
                  aria-label="Task description"
                  className="mt-1 min-h-28 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                  maxLength={20_000}
                  readOnly={!canEdit}
                  value={descriptionDraft}
                  onBlur={() => {
                    if (descriptionDraft !== selectedItem.description)
                      updateTask.mutate({
                        itemId: selectedItem.itemId,
                        description: descriptionDraft,
                      });
                  }}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                />
              )}
            </div>

            {followersEnabled ? (
              <section className="mt-6 border-t border-sand pt-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                    Followers
                  </h3>
                  <button
                    type="button"
                    className="rounded-full border border-sand bg-white px-3 py-1 text-xs"
                    onClick={() =>
                      (followers.data ?? []).some(
                        (entry) =>
                          entry.employeeId === session.data?.employeeId,
                      )
                        ? unfollow.mutate({ itemId: selectedItem.itemId })
                        : follow.mutate({ itemId: selectedItem.itemId })
                    }
                  >
                    {(followers.data ?? []).some(
                      (entry) => entry.employeeId === session.data?.employeeId,
                    )
                      ? "Unfollow"
                      : "Follow"}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(followers.data ?? []).map((entry) => (
                    <span
                      key={entry.employeeId}
                      className="rounded-full bg-white px-3 py-1 text-xs"
                    >
                      {entry.displayName}
                    </span>
                  ))}
                  {!followers.data?.length ? (
                    <span className="text-xs text-muted">
                      No followers yet.
                    </span>
                  ) : null}
                </div>
              </section>
            ) : null}

            {tagsEnabled ? (
              <section className="mt-6 border-t border-sand pt-5">
                <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                  Tags
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(tags.data ?? []).map((tag) => (
                    <label
                      key={tag.tagId}
                      className="flex items-center gap-1.5 rounded-full border border-sand bg-white px-2.5 py-1 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTagIds.has(tag.tagId)}
                        disabled={!canEdit}
                        onChange={(event) => {
                          const next = new Set(selectedTagIds);
                          if (event.target.checked) next.add(tag.tagId);
                          else next.delete(tag.tagId);
                          setTags.mutate({
                            itemId: selectedItem.itemId,
                            tagIds: [...next],
                          });
                        }}
                      />
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: tag.color }}
                      />
                      {tag.name}
                    </label>
                  ))}
                </div>
                {canEdit && projectId ? (
                  <form
                    className="mt-2 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      createTag.mutate({ projectId, name: tagName });
                    }}
                  >
                    <input
                      className="min-w-0 flex-1 rounded border border-sand bg-white px-2 py-1 text-sm"
                      placeholder="New tag"
                      value={tagName}
                      onChange={(event) => setTagName(event.target.value)}
                    />
                    <button
                      className="rounded border border-sand bg-white px-3 py-1 text-sm"
                      disabled={!tagName.trim()}
                    >
                      Add
                    </button>
                  </form>
                ) : null}
              </section>
            ) : null}

            {customFieldsEnabled ? (
              <section className="mt-6 border-t border-sand pt-5">
                <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                  Custom fields
                </h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {(customFields.data ?? []).map((field) => {
                    const value = selectedFieldValues.get(field.customFieldId);
                    const setValue = (next: unknown) =>
                      setCustomField.mutate({
                        itemId: selectedItem.itemId,
                        customFieldId: field.customFieldId,
                        value: next,
                      });
                    return (
                      <label
                        key={field.customFieldId}
                        className="text-xs font-medium"
                      >
                        {field.name}
                        {field.isRequired ? " *" : ""}
                        {field.fieldType === "boolean" ? (
                          <input
                            className="ml-2"
                            type="checkbox"
                            checked={value === true}
                            disabled={!canEdit}
                            onChange={(event) => setValue(event.target.checked)}
                          />
                        ) : field.fieldType === "single_select" ? (
                          <select
                            className="mt-1 w-full rounded border border-sand bg-white px-2 py-1.5 text-sm"
                            value={typeof value === "string" ? value : ""}
                            disabled={!canEdit}
                            onChange={(event) =>
                              setValue(event.target.value || null)
                            }
                          >
                            <option value="">Choose…</option>
                            {field.options.map((option) => (
                              <option key={option}>{option}</option>
                            ))}
                          </select>
                        ) : field.fieldType === "multi_select" ||
                          field.fieldType === "people" ? (
                          <select
                            className="mt-1 h-24 w-full rounded border border-sand bg-white px-2 py-1.5 text-sm"
                            multiple
                            value={
                              Array.isArray(value) ? value.map(String) : []
                            }
                            disabled={!canEdit}
                            onChange={(event) =>
                              setValue(
                                [...event.target.selectedOptions].map(
                                  (option) => option.value,
                                ),
                              )
                            }
                          >
                            {(field.fieldType === "people"
                              ? (employees.data ?? []).map((employee) => ({
                                  value: employee.employeeId,
                                  label: employee.displayLabel,
                                }))
                              : field.options.map((option) => ({
                                  value: option,
                                  label: option,
                                }))
                            ).map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            key={`${field.customFieldId}:${String(value ?? "")}`}
                            className="mt-1 w-full rounded border border-sand bg-white px-2 py-1.5 text-sm"
                            type={
                              field.fieldType === "number"
                                ? "number"
                                : field.fieldType === "date"
                                  ? "date"
                                  : "text"
                            }
                            defaultValue={
                              typeof value === "string" ||
                              typeof value === "number"
                                ? value
                                : ""
                            }
                            readOnly={!canEdit}
                            onBlur={(event) => {
                              const raw = event.target.value;
                              setValue(
                                raw === ""
                                  ? null
                                  : field.fieldType === "number"
                                    ? Number(raw)
                                    : raw,
                              );
                            }}
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
                {canEdit && projectId ? (
                  <form
                    className="mt-3 grid gap-2 sm:grid-cols-[1fr_9rem_1fr_auto]"
                    onSubmit={(event) => {
                      event.preventDefault();
                      createCustomField.mutate({
                        projectId,
                        name: fieldName,
                        fieldType,
                        options: fieldOptions
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean),
                        isRequired: false,
                      });
                    }}
                  >
                    <input
                      className="rounded border border-sand bg-white px-2 py-1 text-sm"
                      placeholder="Field name"
                      value={fieldName}
                      onChange={(event) => setFieldName(event.target.value)}
                    />
                    <select
                      className="rounded border border-sand bg-white px-2 py-1 text-sm"
                      value={fieldType}
                      onChange={(event) =>
                        setFieldType(event.target.value as typeof fieldType)
                      }
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="date">Date</option>
                      <option value="boolean">Yes / no</option>
                      <option value="single_select">Single select</option>
                      <option value="multi_select">Multi select</option>
                      <option value="people">People</option>
                    </select>
                    <input
                      className="rounded border border-sand bg-white px-2 py-1 text-sm"
                      placeholder="Options, comma separated"
                      value={fieldOptions}
                      disabled={
                        fieldType !== "single_select" &&
                        fieldType !== "multi_select"
                      }
                      onChange={(event) => setFieldOptions(event.target.value)}
                    />
                    <button
                      className="rounded border border-sand bg-white px-3 py-1 text-sm"
                      disabled={!fieldName.trim()}
                    >
                      Add
                    </button>
                  </form>
                ) : null}
              </section>
            ) : null}

            {customTaskTypesEnabled ? (
              <section className="mt-6 border-t border-sand pt-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                    Custom task types
                  </h3>
                  <select
                    aria-label="Project to share task type with"
                    className="rounded border border-sand bg-white px-2 py-1 text-xs"
                    value={shareTargetProjectId}
                    onChange={(event) =>
                      setShareTargetProjectId(event.target.value)
                    }
                  >
                    <option value="">Share with project…</option>
                    {(projects.data ?? [])
                      .filter((project) => project.projectId !== projectId)
                      .map((project) => (
                        <option
                          key={project.projectId}
                          value={project.projectId}
                        >
                          {project.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="mt-3 space-y-2">
                  {(customTaskTypes.data ?? []).map((type) => (
                    <div
                      key={type.customTaskTypeId}
                      className="rounded-lg border border-sand bg-white p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">
                          {type.icon} {type.name}
                          {type.sourcePlatform === "asana" ? (
                            <span className="ml-2 text-[10px] uppercase text-muted">
                              Asana
                            </span>
                          ) : null}
                          {!type.isAssociated ? (
                            <span className="ml-2 text-[10px] uppercase text-muted">
                              Task only
                            </span>
                          ) : null}
                        </p>
                        {canEdit &&
                        projectId &&
                        canUseCustomTaskType(type.accessLevel) ? (
                          <div className="flex flex-wrap gap-2">
                            {type.isAssociated ? (
                              <>
                                <button
                                  type="button"
                                  className="rounded-full border border-sand px-2.5 py-1 text-xs"
                                  onClick={() =>
                                    setDefaultCustomTaskType.mutate({
                                      projectId,
                                      customTaskTypeId: type.isDefault
                                        ? null
                                        : type.customTaskTypeId,
                                    })
                                  }
                                >
                                  {type.isDefault
                                    ? "Default ✓"
                                    : "Make default"}
                                </button>
                                <button
                                  type="button"
                                  className="rounded-full border border-sand px-2.5 py-1 text-xs"
                                  disabled={!shareTargetProjectId}
                                  onClick={() =>
                                    shareCustomTaskType.mutate({
                                      sourceProjectId: projectId,
                                      targetProjectId: shareTargetProjectId,
                                      customTaskTypeId: type.customTaskTypeId,
                                    })
                                  }
                                >
                                  Share
                                </button>
                                <button
                                  type="button"
                                  className="rounded-full border border-sand px-2.5 py-1 text-xs"
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        "Remove this task type from the project? Tasks already using it will keep their type and status.",
                                      )
                                    )
                                      removeCustomTaskTypeFromProject.mutate({
                                        projectId,
                                        customTaskTypeId: type.customTaskTypeId,
                                      });
                                  }}
                                >
                                  Remove
                                </button>
                              </>
                            ) : null}
                            {type.sourcePlatform === "native" &&
                            canUseCustomTaskType(type.accessLevel, "editor") ? (
                              <button
                                type="button"
                                className="rounded-full border border-sand px-2.5 py-1 text-xs"
                                onClick={() => {
                                  setEditingCustomTaskTypeId(
                                    type.customTaskTypeId,
                                  );
                                  setCustomTaskTypeEditName(type.name);
                                  setCustomTaskTypeEditIcon(type.icon);
                                  setCustomTaskTypeEditStatuses(
                                    type.statuses.map((status) => ({
                                      statusOptionId: status.statusOptionId,
                                      name: status.name,
                                      color: status.color,
                                      completionState: status.completionState,
                                      enabled: status.enabled,
                                    })),
                                  );
                                }}
                              >
                                Edit
                              </button>
                            ) : null}
                            {type.accessLevel === "admin" ? (
                              <button
                                type="button"
                                className="rounded-full border border-sand px-2.5 py-1 text-xs"
                                onClick={() =>
                                  setAccessCustomTaskTypeId((current) =>
                                    current === type.customTaskTypeId
                                      ? null
                                      : type.customTaskTypeId,
                                  )
                                }
                              >
                                Manage access
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {type.statuses.map((status) => (
                          <span
                            key={status.statusOptionId}
                            className={`rounded-full border px-2 py-0.5 text-[10px] ${status.enabled ? "" : "opacity-50"}`}
                            style={{ borderColor: status.color }}
                          >
                            {status.name}
                            {status.completionState === "complete" ? " ✓" : ""}
                          </span>
                        ))}
                      </div>
                      {accessCustomTaskTypeId === type.customTaskTypeId &&
                      projectId &&
                      customTaskTypeAccess.data ? (
                        <div className="mt-3 space-y-3 border-t border-sand pt-3 text-xs">
                          <label className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:items-center">
                            Organization access
                            <select
                              aria-label="Organization task type access"
                              className="rounded border border-sand bg-white px-2 py-1"
                              value={
                                customTaskTypeAccess.data.defaultAccessLevel
                              }
                              onChange={(event) =>
                                setCustomTaskTypeDefaultAccess.mutate({
                                  projectId,
                                  customTaskTypeId: type.customTaskTypeId,
                                  accessLevel: event.target
                                    .value as CustomTaskTypeAccessLevel,
                                })
                              }
                            >
                              <option value="admin">Admin</option>
                              <option value="editor">Editor</option>
                              <option value="user">User</option>
                              <option value="none">No access</option>
                            </select>
                          </label>
                          <div className="space-y-1">
                            {customTaskTypeAccess.data.members.map((member) => (
                              <div
                                key={`${member.memberType}:${member.memberId}`}
                                className="flex flex-wrap items-center justify-between gap-2 rounded border border-sand px-2 py-1"
                              >
                                <span>
                                  {member.memberType === "employee"
                                    ? (employeeById.get(member.memberId)
                                        ?.displayName ?? member.memberId)
                                    : (teams.data?.find(
                                        (team) =>
                                          team.teamId === member.memberId,
                                      )?.name ?? member.memberId)}
                                  {` · ${member.accessLevel}`}
                                </span>
                                <button
                                  type="button"
                                  className="rounded border border-sand px-2 py-0.5"
                                  onClick={() =>
                                    updateCustomTaskTypeMemberAccess.mutate({
                                      projectId,
                                      customTaskTypeId: type.customTaskTypeId,
                                      memberType: member.memberType,
                                      memberId: member.memberId,
                                      accessLevel: null,
                                    })
                                  }
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                          <form
                            className="grid gap-2 sm:grid-cols-[7rem_1fr_7rem_auto]"
                            onSubmit={(event) => {
                              event.preventDefault();
                              if (!customTaskTypeMemberId) return;
                              updateCustomTaskTypeMemberAccess.mutate({
                                projectId,
                                customTaskTypeId: type.customTaskTypeId,
                                memberType: customTaskTypeMemberType,
                                memberId: customTaskTypeMemberId,
                                accessLevel: customTaskTypeMemberAccess,
                              });
                            }}
                          >
                            <select
                              aria-label="Task type member kind"
                              className="rounded border border-sand bg-white px-2 py-1"
                              value={customTaskTypeMemberType}
                              onChange={(event) => {
                                setCustomTaskTypeMemberType(
                                  event.target.value as "employee" | "team",
                                );
                                setCustomTaskTypeMemberId("");
                              }}
                            >
                              <option value="employee">Person</option>
                              <option value="team">Team</option>
                            </select>
                            <select
                              aria-label="Task type member"
                              className="rounded border border-sand bg-white px-2 py-1"
                              value={customTaskTypeMemberId}
                              onChange={(event) =>
                                setCustomTaskTypeMemberId(event.target.value)
                              }
                            >
                              <option value="">Choose…</option>
                              {customTaskTypeMemberType === "employee"
                                ? (employees.data ?? []).map((employee) => (
                                    <option
                                      key={employee.employeeId}
                                      value={employee.employeeId}
                                    >
                                      {employee.displayName}
                                    </option>
                                  ))
                                : (teams.data ?? []).map((team) => (
                                    <option
                                      key={team.teamId}
                                      value={team.teamId}
                                    >
                                      {team.name}
                                    </option>
                                  ))}
                            </select>
                            <select
                              aria-label="Task type member access"
                              className="rounded border border-sand bg-white px-2 py-1"
                              value={customTaskTypeMemberAccess}
                              onChange={(event) =>
                                setCustomTaskTypeMemberAccess(
                                  event.target.value as
                                    "admin" | "editor" | "user",
                                )
                              }
                            >
                              <option value="admin">Admin</option>
                              <option value="editor">Editor</option>
                              <option value="user">User</option>
                            </select>
                            <button
                              className="rounded bg-ink px-3 py-1 text-white"
                              disabled={!customTaskTypeMemberId}
                            >
                              Add
                            </button>
                          </form>
                        </div>
                      ) : null}
                      {editingCustomTaskTypeId === type.customTaskTypeId &&
                      projectId ? (
                        <form
                          className="mt-3 space-y-2 border-t border-sand pt-3"
                          onSubmit={(event) => {
                            event.preventDefault();
                            updateCustomTaskType.mutate({
                              projectId,
                              customTaskTypeId: type.customTaskTypeId,
                              name: customTaskTypeEditName,
                              icon: customTaskTypeEditIcon,
                              statuses: customTaskTypeEditStatuses
                                .filter((status) => status.enabled)
                                .map(
                                  ({ enabled: _enabled, ...status }) => status,
                                ),
                            });
                          }}
                        >
                          <div className="grid grid-cols-[4rem_1fr] gap-2">
                            <input
                              aria-label="Edit task type icon"
                              className="rounded border border-sand px-2 py-1 text-center text-sm"
                              maxLength={16}
                              value={customTaskTypeEditIcon}
                              onChange={(event) =>
                                setCustomTaskTypeEditIcon(event.target.value)
                              }
                            />
                            <input
                              aria-label="Edit task type name"
                              className="rounded border border-sand px-2 py-1 text-sm"
                              maxLength={120}
                              value={customTaskTypeEditName}
                              onChange={(event) =>
                                setCustomTaskTypeEditName(event.target.value)
                              }
                            />
                          </div>
                          {customTaskTypeEditStatuses.map((status, index) => (
                            <div
                              key={status.statusOptionId ?? `new-${index}`}
                              className="grid gap-2 sm:grid-cols-[auto_1fr_3rem_8rem]"
                            >
                              <input
                                aria-label={`Enable status ${status.name || index + 1}`}
                                type="checkbox"
                                checked={status.enabled}
                                onChange={(event) =>
                                  setCustomTaskTypeEditStatuses((current) =>
                                    current.map((candidate, candidateIndex) =>
                                      candidateIndex === index
                                        ? {
                                            ...candidate,
                                            enabled: event.target.checked,
                                          }
                                        : candidate,
                                    ),
                                  )
                                }
                              />
                              <input
                                aria-label={`Status ${index + 1} name`}
                                className="rounded border border-sand px-2 py-1 text-sm"
                                maxLength={120}
                                value={status.name}
                                onChange={(event) =>
                                  setCustomTaskTypeEditStatuses((current) =>
                                    current.map((candidate, candidateIndex) =>
                                      candidateIndex === index
                                        ? {
                                            ...candidate,
                                            name: event.target.value,
                                          }
                                        : candidate,
                                    ),
                                  )
                                }
                              />
                              <input
                                aria-label={`Status ${index + 1} color`}
                                className="h-8 w-12 rounded border border-sand"
                                type="color"
                                value={status.color}
                                onChange={(event) =>
                                  setCustomTaskTypeEditStatuses((current) =>
                                    current.map((candidate, candidateIndex) =>
                                      candidateIndex === index
                                        ? {
                                            ...candidate,
                                            color: event.target.value,
                                          }
                                        : candidate,
                                    ),
                                  )
                                }
                              />
                              <select
                                aria-label={`Status ${index + 1} completion`}
                                className="rounded border border-sand px-2 py-1 text-sm"
                                value={status.completionState}
                                onChange={(event) =>
                                  setCustomTaskTypeEditStatuses((current) =>
                                    current.map((candidate, candidateIndex) =>
                                      candidateIndex === index
                                        ? {
                                            ...candidate,
                                            completionState: event.target
                                              .value as
                                              "incomplete" | "complete",
                                          }
                                        : candidate,
                                    ),
                                  )
                                }
                              >
                                <option value="incomplete">Incomplete</option>
                                <option value="complete">Complete</option>
                              </select>
                            </div>
                          ))}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded border border-sand px-3 py-1 text-xs"
                              onClick={() =>
                                setCustomTaskTypeEditStatuses((current) => [
                                  ...current,
                                  {
                                    name: "",
                                    color: "#6B7280",
                                    completionState: "incomplete",
                                    enabled: true,
                                  },
                                ])
                              }
                            >
                              Add status
                            </button>
                            <button
                              className="rounded bg-ink px-3 py-1 text-xs text-white"
                              disabled={
                                !customTaskTypeEditName.trim() ||
                                !customTaskTypeEditIcon.trim() ||
                                customTaskTypeEditStatuses.filter(
                                  (status) => status.enabled,
                                ).length < 2 ||
                                customTaskTypeEditStatuses.some(
                                  (status) =>
                                    status.enabled && !status.name.trim(),
                                ) ||
                                !customTaskTypeEditStatuses.some(
                                  (status) =>
                                    status.enabled &&
                                    status.completionState === "incomplete",
                                ) ||
                                !customTaskTypeEditStatuses.some(
                                  (status) =>
                                    status.enabled &&
                                    status.completionState === "complete",
                                )
                              }
                            >
                              Save changes
                            </button>
                            <button
                              type="button"
                              className="rounded border border-sand px-3 py-1 text-xs"
                              onClick={() => setEditingCustomTaskTypeId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  ))}
                </div>
                {canEdit && projectId ? (
                  <form
                    className="mt-3 grid gap-2 sm:grid-cols-[4rem_1fr]"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const incomplete = customTaskIncompleteStatuses
                        .split(",")
                        .map((name) => name.trim())
                        .filter(Boolean);
                      if (
                        !incomplete.length ||
                        !customTaskCompleteStatus.trim()
                      )
                        return;
                      createCustomTaskType.mutate({
                        projectId,
                        name: customTaskTypeName,
                        icon: customTaskTypeIcon,
                        isDefault: false,
                        statuses: [
                          ...incomplete.map((name) => ({
                            name,
                            color: "#6B7280",
                            completionState: "incomplete" as const,
                          })),
                          {
                            name: customTaskCompleteStatus.trim(),
                            color: "#2E7D5B",
                            completionState: "complete" as const,
                          },
                        ],
                      });
                    }}
                  >
                    <input
                      aria-label="Task type icon"
                      className="rounded border border-sand bg-white px-2 py-1 text-center text-sm"
                      maxLength={16}
                      value={customTaskTypeIcon}
                      onChange={(event) =>
                        setCustomTaskTypeIcon(event.target.value)
                      }
                    />
                    <input
                      aria-label="Task type name"
                      className="rounded border border-sand bg-white px-2 py-1 text-sm"
                      placeholder="Type name, e.g. Request"
                      value={customTaskTypeName}
                      onChange={(event) =>
                        setCustomTaskTypeName(event.target.value)
                      }
                    />
                    <input
                      aria-label="Incomplete statuses"
                      className="rounded border border-sand bg-white px-2 py-1 text-sm sm:col-span-2"
                      placeholder="Incomplete statuses, comma separated"
                      value={customTaskIncompleteStatuses}
                      onChange={(event) =>
                        setCustomTaskIncompleteStatuses(event.target.value)
                      }
                    />
                    <input
                      aria-label="Complete status"
                      className="rounded border border-sand bg-white px-2 py-1 text-sm sm:col-span-2"
                      placeholder="Complete status"
                      value={customTaskCompleteStatus}
                      onChange={(event) =>
                        setCustomTaskCompleteStatus(event.target.value)
                      }
                    />
                    <button
                      className="rounded border border-sand bg-white px-3 py-1 text-sm sm:col-span-2"
                      disabled={
                        !customTaskTypeName.trim() ||
                        !customTaskIncompleteStatuses.trim() ||
                        !customTaskCompleteStatus.trim()
                      }
                    >
                      Add task type
                    </button>
                  </form>
                ) : null}
              </section>
            ) : null}

            {recurrenceEnabled ? (
              <section className="mt-6 border-t border-sand pt-5">
                <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                  Repeat
                  <select
                    className="mt-1 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                    value={selectedItem.recurrence?.frequency ?? ""}
                    disabled={!canEdit}
                    onChange={(event) =>
                      setRecurrence.mutate({
                        itemId: selectedItem.itemId,
                        recurrence: event.target.value
                          ? {
                              frequency: event.target.value as
                                "daily" | "weekly" | "monthly" | "yearly",
                              interval: 1,
                            }
                          : null,
                      })
                    }
                  >
                    <option value="">Does not repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </label>
                {selectedItem.recurrence ? (
                  <p className="mt-1 text-xs text-muted">
                    The next occurrence is created when this task is completed.
                  </p>
                ) : null}
              </section>
            ) : null}

            {attachmentsEnabled ? (
              <section className="mt-6 border-t border-sand pt-5">
                <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                  Attachments
                </h3>
                <div className="mt-2 space-y-2">
                  {(attachments.data ?? []).map((attachment) => (
                    <div
                      key={attachment.attachmentId}
                      className="flex items-center justify-between gap-3 rounded border border-sand bg-white p-2 text-sm"
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left font-medium"
                        onClick={() =>
                          void openAttachment
                            .mutateAsync({
                              attachmentId: attachment.attachmentId,
                            })
                            .then((result) =>
                              window.open(
                                result.url,
                                "_blank",
                                "noopener,noreferrer",
                              ),
                            )
                        }
                      >
                        📎 {attachment.name}
                      </button>
                      <div className="flex items-center gap-2">
                        {proofingEnabled &&
                        canComment &&
                        isProofableAttachment(attachment) ? (
                          <button
                            type="button"
                            className="rounded-full border border-sand px-2.5 py-1 text-xs text-muted"
                            onClick={() => setProofingAttachment(attachment)}
                          >
                            Proof
                          </button>
                        ) : null}
                        <WorkLikeButton
                          targetType="attachment"
                          targetId={attachment.attachmentId}
                        />
                        {canEdit ? (
                          <button
                            type="button"
                            aria-label={`Remove ${attachment.name}`}
                            onClick={() =>
                              removeAttachment.mutate({
                                attachmentId: attachment.attachmentId,
                              })
                            }
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                {canEdit ? (
                  <div className="mt-3 space-y-2">
                    <label className="block rounded border border-dashed border-sand bg-white p-2 text-center text-sm">
                      {uploadAttachment.isPending
                        ? "Uploading…"
                        : "Upload file"}
                      <input
                        className="sr-only"
                        type="file"
                        disabled={uploadAttachment.isPending}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file || file.size > 10_000_000) return;
                          void fileAsBase64(file).then((contentBase64) =>
                            uploadAttachment.mutate({
                              itemId: selectedItem.itemId,
                              fileName: file.name,
                              contentType:
                                file.type || "application/octet-stream",
                              contentBase64,
                            }),
                          );
                        }}
                      />
                    </label>
                    <form
                      className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                      onSubmit={(event) => {
                        event.preventDefault();
                        addAttachmentLink.mutate({
                          itemId: selectedItem.itemId,
                          name: attachmentName,
                          url: attachmentUrl,
                        });
                      }}
                    >
                      <input
                        className="rounded border border-sand bg-white px-2 py-1 text-sm"
                        placeholder="Link name"
                        value={attachmentName}
                        onChange={(event) =>
                          setAttachmentName(event.target.value)
                        }
                      />
                      <input
                        className="rounded border border-sand bg-white px-2 py-1 text-sm"
                        type="url"
                        placeholder="https://…"
                        value={attachmentUrl}
                        onChange={(event) =>
                          setAttachmentUrl(event.target.value)
                        }
                      />
                      <button
                        className="rounded border border-sand bg-white px-3 py-1 text-sm"
                        disabled={
                          !attachmentName.trim() || !attachmentUrl.trim()
                        }
                      >
                        Add
                      </button>
                    </form>
                  </div>
                ) : null}
              </section>
            ) : null}

            {subtasksEnabled ? (
              <section className="mt-6">
                <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                  Subtasks
                </h3>
                <div className="mt-2 overflow-hidden rounded-lg border border-sand">
                  {items
                    .filter((item) => item.parentItemId === selectedItem.itemId)
                    .map(taskRow)}
                  {canEdit && projectId ? (
                    <form
                      className="flex gap-2 border-t border-sand bg-white/50 p-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        createTask.mutate({
                          projectId,
                          parentItemId: selectedItem.itemId,
                          sectionId: selectedItem.sectionId,
                          title: subtask,
                          description: "",
                        });
                      }}
                    >
                      <input
                        className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm outline-none"
                        placeholder="Add subtask"
                        value={subtask}
                        onChange={(event) => setSubtask(event.target.value)}
                      />
                      <button
                        className="text-sm font-medium text-ochre"
                        disabled={!subtask.trim()}
                      >
                        Add
                      </button>
                    </form>
                  ) : null}
                </div>
              </section>
            ) : null}

            {dependenciesEnabled ? (
              <section className="mt-6">
                <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                  Waiting on
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(dependencies.get(selectedItem.itemId) ?? []).map((id) => {
                    const dependency = items.find((item) => item.itemId === id);
                    return dependency ? (
                      <span
                        key={id}
                        className="flex items-center gap-2 rounded-full border border-sand bg-white px-3 py-1.5 text-xs"
                      >
                        {dependency.title}
                        {canEdit ? (
                          <button
                            type="button"
                            aria-label={`Remove ${dependency.title}`}
                            onClick={() =>
                              removeDependency.mutate({
                                itemId: selectedItem.itemId,
                                dependsOnItemId: id,
                              })
                            }
                          >
                            ×
                          </button>
                        ) : null}
                      </span>
                    ) : null;
                  })}
                </div>
                {canEdit ? (
                  <div className="mt-2 flex gap-2">
                    <select
                      className="min-w-0 flex-1 rounded-lg border border-sand bg-white px-3 py-2 text-sm"
                      value={dependencyId}
                      onChange={(event) => setDependencyId(event.target.value)}
                    >
                      <option value="">Choose a task</option>
                      {items
                        .filter(
                          (item) =>
                            item.itemId !== selectedItem.itemId &&
                            !(
                              dependencies.get(selectedItem.itemId) ?? []
                            ).includes(item.itemId),
                        )
                        .map((item) => (
                          <option key={item.itemId} value={item.itemId}>
                            {item.title}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
                      disabled={!dependencyId}
                      onClick={() =>
                        addDependency.mutate({
                          itemId: selectedItem.itemId,
                          dependsOnItemId: dependencyId,
                        })
                      }
                    >
                      Add
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}

            {commentsEnabled ? (
              <section className="mt-6 border-t border-sand pt-5">
                <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                  Comments
                </h3>
                <div className="mt-3 flex flex-col gap-3">
                  {(comments.data ?? []).map((entry) => (
                    <div
                      key={entry.commentId}
                      className="rounded-lg border border-sand bg-white p-3"
                    >
                      <div className="flex justify-between gap-3 text-xs">
                        <strong>{entry.authorName}</strong>
                        <span className="text-muted">
                          {new Date(entry.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {richTextEnabled ? (
                        <WorkRichText
                          className="mt-2 text-sm"
                          value={entry.body}
                        />
                      ) : (
                        <p className="mt-2 whitespace-pre-wrap text-sm">
                          {entry.body}
                        </p>
                      )}
                      <div className="mt-2">
                        <WorkLikeButton
                          targetType="comment"
                          targetId={entry.commentId}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {canComment ? (
                  <form
                    className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"
                    onSubmit={(event) => {
                      event.preventDefault();
                      createComment.mutate({
                        itemId: selectedItem.itemId,
                        body: comment,
                      });
                    }}
                  >
                    {richTextEnabled ? (
                      <WorkRichTextEditor
                        ariaLabel="Comment"
                        maxLength={20_000}
                        mentions={mentionOptions}
                        placeholder="Write a comment"
                        value={comment}
                        onChange={setComment}
                      />
                    ) : (
                      <textarea
                        aria-label="Comment"
                        className="min-h-20 min-w-0 flex-1 rounded-lg border border-sand bg-white px-3 py-2 text-sm"
                        maxLength={20_000}
                        placeholder="Write a comment"
                        value={comment}
                        onChange={(event) => setComment(event.target.value)}
                      />
                    )}
                    <button
                      className="self-end rounded-lg bg-ochre px-4 py-2 text-sm font-medium text-white"
                      disabled={!comment.trim()}
                    >
                      Post
                    </button>
                  </form>
                ) : null}
              </section>
            ) : null}
          </aside>
        </div>
      ) : null}
      {proofingAttachment ? (
        <WorkProofingDialog
          attachment={proofingAttachment}
          employees={employees.data ?? []}
          onClose={() => setProofingAttachment(null)}
          onChanged={refreshProject}
          onOpenTask={(itemId) => {
            setProofingAttachment(null);
            setSelectedItemId(itemId);
          }}
        />
      ) : null}
    </main>
  );
}
