export function orderOutreachWorkItems<
  T extends { id: string; createdAt: string },
>(items: readonly T[], focusId?: string | null): T[] {
  return [...items].sort((a, b) => {
    if (a.id === focusId) return -1;
    if (b.id === focusId) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}
