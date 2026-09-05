import { z } from "zod";
import { router, staffProcedure } from "./trpc";
import {
  deleteWorkbookView,
  editWorkbook,
  saveWorkbookView,
  savedWorkbookViews,
  workbookSnapshot,
} from "../crm/workbook";
import {
  filterWorkbookRows,
  viewConfigSchema,
  visibleColumns,
  WORKBOOK_COLUMNS,
  WORKBOOK_TABS,
  TAB_LABELS,
  workbookHealth,
} from "@/lib/crm-workbook";
import { toCsv } from "../crm/csv";

const editSchema = z
  .object({
    kind: z.enum(["companies", "contacts", "deals", "clients", "followups"]),
    records: z
      .array(z.object({ id: z.string().uuid(), updatedAt: z.string().max(60) }))
      .min(1)
      .max(100),
    field: z.enum(["ownerId", "title", "due", "status", "renewal"]),
    value: z.string().trim().max(300).nullable(),
  })
  .superRefine((input, ctx) => {
    const allowed: Record<string, string[]> = {
      companies: ["ownerId"],
      contacts: ["ownerId"],
      deals: ["ownerId"],
      clients: ["ownerId", "renewal", "status"],
      followups: ["ownerId", "title", "due", "status"],
    };
    const error = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (!allowed[input.kind]!.includes(input.field))
      error("This field cannot be edited for these records.");
    if (new Set(input.records.map((r) => r.id)).size !== input.records.length)
      error("Duplicate record selection.");
    if (
      input.field === "ownerId" &&
      input.value !== null &&
      !z.string().uuid().safeParse(input.value).success
    )
      error("Select an employee.");
    if (
      ["due", "renewal"].includes(input.field) &&
      input.value !== null &&
      !z.string().date().safeParse(input.value).success
    )
      error("Enter a valid date.");
    if (input.field === "title" && !input.value)
      error("A follow-up needs a title.");
    if (
      input.field === "status" &&
      !(
        input.kind === "clients"
          ? ["onboarding", "active", "renewing", "at_risk", "churned", "closed"]
          : ["open", "in_progress", "done", "cancelled"]
      ).includes(input.value ?? "")
    )
      error("Choose a valid status.");
  });

export const crmWorkbookRouter = router({
  snapshot: staffProcedure.query(async () => {
    const data = await workbookSnapshot();
    return { ...data, health: workbookHealth(data.rows) };
  }),
  edit: staffProcedure
    .input(editSchema)
    .mutation(({ ctx, input }) => editWorkbook(ctx.employeeId!, input)),
  views: staffProcedure.query(async ({ ctx }) =>
    (await savedWorkbookViews(ctx.employeeId!)).filter(
      (view) => !ctx.workspacePreview || view.visibility === "team",
    ),
  ),
  saveView: staffProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(80),
        visibility: z.enum(["personal", "team"]),
        config: viewConfigSchema,
      }),
    )
    .mutation(({ ctx, input }) => saveWorkbookView(ctx.employeeId!, input)),
  deleteView: staffProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      deleteWorkbookView(ctx.employeeId!, input.id),
    ),
  export: staffProcedure
    .input(
      z.object({
        config: viewConfigSchema,
        ids: z.array(z.string().uuid()).max(5000).optional(),
        allTabs: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { rows } = await workbookSnapshot();
      const tabs = input.allTabs ? WORKBOOK_TABS : [input.config.tab];
      const sheets = tabs.map((tab) => {
        const config = {
          ...input.config,
          tab,
          columns: tab === input.config.tab ? input.config.columns : [],
        };
        const columns = visibleColumns(config);
        const visible = filterWorkbookRows(
          rows,
          config,
          ctx.employeeId!,
        ).filter((row) => !input.ids || input.ids.includes(row.id));
        const headers = [
          "Record ID",
          ...columns.map((c) => WORKBOOK_COLUMNS[c]),
        ];
        const cells = visible.map((row) => [
          row.id,
          ...columns.map((c) => String(row[c] ?? "")),
        ]);
        return { name: TAB_LABELS[tab], headers, rows: cells };
      });
      const first = sheets[0]!;
      return {
        sheets,
        csv: toCsv(
          first.headers,
          first.rows.map((cells) =>
            Object.fromEntries(first.headers.map((h, i) => [h, cells[i]])),
          ),
        ),
      };
    }),
});
