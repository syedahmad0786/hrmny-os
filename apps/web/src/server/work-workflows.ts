export type WorkRuleField =
  | "title"
  | "priority"
  | "completed"
  | "sectionId"
  | "itemType"
  | "customTaskTypeId"
  | "customTaskStatusOptionId";

export type WorkFormQuestion = {
  key: string;
  label: string;
  type:
    | "text"
    | "textarea"
    | "single_select"
    | "multi_select"
    | "date"
    | "number"
    | "checkbox"
    | "attachment";
  required: boolean;
  options: string[];
  multiple?: boolean;
  showWhen?: { key: string; equals: string | boolean };
};

export type WorkFormAttachmentAnswer = {
  fileName: string;
  contentType: string;
  contentBase64: string;
};

function validAttachmentAnswer(
  value: unknown,
): value is WorkFormAttachmentAnswer {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<WorkFormAttachmentAnswer>;
  return (
    typeof file.fileName === "string" &&
    file.fileName.trim().length > 0 &&
    file.fileName.length <= 255 &&
    typeof file.contentType === "string" &&
    file.contentType.length > 0 &&
    file.contentType.length <= 160 &&
    typeof file.contentBase64 === "string" &&
    file.contentBase64.length > 0 &&
    file.contentBase64.length <= 14_000_000 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      file.contentBase64,
    )
  );
}

export function normalizeFormAnswers(
  questions: readonly WorkFormQuestion[],
  input: Record<string, unknown>,
): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const question of questions) {
    if (
      question.showWhen &&
      input[question.showWhen.key] !== question.showWhen.equals
    ) {
      continue;
    }
    const value = input[question.key];
    const empty =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (question.required && empty)
      throw new Error(`${question.label} is required`);
    if (empty) continue;
    if (question.type === "attachment") {
      if (
        !Array.isArray(value) ||
        value.length > (question.multiple ? 10 : 1) ||
        value.some((file) => !validAttachmentAnswer(file))
      )
        throw new Error(`${question.label} is invalid`);
      answers[question.key] = value.map((file) => ({ ...file }));
      continue;
    }
    if (
      (["text", "textarea", "date"] as const).includes(
        question.type as "text" | "textarea" | "date",
      ) &&
      (typeof value !== "string" || value.length > 20_000)
    ) {
      throw new Error(`${question.label} is invalid`);
    }
    if (
      question.type === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value as string) ||
        new Date(`${String(value)}T00:00:00Z`).toISOString().slice(0, 10) !==
          value)
    ) {
      throw new Error(`${question.label} is invalid`);
    }
    if (
      question.type === "number" &&
      (typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new Error(`${question.label} is invalid`);
    }
    if (question.type === "checkbox" && typeof value !== "boolean")
      throw new Error(`${question.label} is invalid`);
    if (
      question.type === "single_select" &&
      (typeof value !== "string" || !question.options.includes(value))
    ) {
      throw new Error(`${question.label} is invalid`);
    }
    if (
      question.type === "multi_select" &&
      (!Array.isArray(value) ||
        value.length > 100 ||
        value.some(
          (entry) =>
            typeof entry !== "string" || !question.options.includes(entry),
        ))
    ) {
      throw new Error(`${question.label} is invalid`);
    }
    answers[question.key] =
      question.type === "multi_select"
        ? [...new Set(value as string[])]
        : value;
  }
  return answers;
}

export type WorkRuleCondition = {
  field: WorkRuleField;
  operator: "equals" | "not_equals" | "contains" | "is_empty" | "is_not_empty";
  value?: string | boolean | null;
};

export type WorkRuleAction =
  | { type: "set_priority"; value: "low" | "medium" | "high" | "urgent" | null }
  | { type: "move_section"; sectionId: string }
  | { type: "assign"; employeeId: string | null }
  | { type: "complete" }
  | {
      type: "set_custom_task_status";
      customTaskTypeId: string;
      statusOptionId: string;
    }
  | { type: "add_tag"; tagId: string }
  | { type: "send_webhook"; message: string }
  | { type: "create_subtask"; title: string; dueInDays?: number };

export type WorkRuleBranch = {
  mode: "all" | "any";
  conditions: WorkRuleCondition[];
  actions: WorkRuleAction[];
};

export type WorkRuleSnapshot = {
  title: string;
  priority: string | null;
  completed: boolean;
  sectionId: string | null;
  itemType: string;
  customTaskTypeId: string | null;
  customTaskStatusOptionId: string | null;
};

export function ruleBranchMatches(
  branch: WorkRuleBranch,
  item: WorkRuleSnapshot,
): boolean {
  if (!branch.conditions.length) return true;
  const results = branch.conditions.map((condition) => {
    const current = item[condition.field];
    if (condition.operator === "is_empty")
      return current === null || current === "";
    if (condition.operator === "is_not_empty")
      return current !== null && current !== "";
    if (condition.operator === "contains")
      return (
        typeof current === "string" &&
        typeof condition.value === "string" &&
        current.toLowerCase().includes(condition.value.toLowerCase())
      );
    return condition.operator === "equals"
      ? current === condition.value
      : current !== condition.value;
  });
  return branch.mode === "all" ? results.every(Boolean) : results.some(Boolean);
}

export function relativeDate(days: number, from = new Date()): string {
  const result = new Date(from);
  result.setUTCDate(
    result.getUTCDate() + Math.max(-3650, Math.min(3650, days)),
  );
  return result.toISOString();
}
