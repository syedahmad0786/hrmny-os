export type SubtaskSort = "manual" | "due_date" | "assignee" | "title";

type Subtask = {
  parentItemId: string | null;
  position: number;
  dueAt: string | null;
  assigneeName: string | null;
  title: string;
  completedAt: string | null;
};

export function visibleSubtasks<T extends Subtask>(
  items: readonly T[],
  parentItemId: string,
  options: { showCompleted: boolean; sort: SubtaskSort },
) {
  const value = items.filter(
    (item) =>
      item.parentItemId === parentItemId &&
      (options.showCompleted || !item.completedAt),
  );
  return value.sort((left, right) => {
    if (options.sort === "manual") return left.position - right.position;
    if (options.sort === "due_date")
      return (left.dueAt ?? "9999").localeCompare(right.dueAt ?? "9999");
    if (options.sort === "assignee")
      return (left.assigneeName ?? "\uffff").localeCompare(
        right.assigneeName ?? "\uffff",
      );
    return left.title.localeCompare(right.title);
  });
}
