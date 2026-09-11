import { z } from "zod";
import { linkedinProfileUrl } from "@/lib/linkedin-profile";
import { sessionCanViewMargin, type SessionUser } from "../auth/session";
import { searchComposioConnectedData } from "../composio-connected-data-ai";
import { featureEnabled } from "../features";
import { outreachSnapshotHash } from "../leadgen/outreach-review";
import { searchGoogleMapsDiscovery } from "../integrations/google-maps-search";
import { getOutreach, type OutreachItem } from "../leadgen/store";
import { getVerifiedWorkAppConnection } from "../trpc/connections-router";
import { createCaller } from "../trpc/root";
import { qmStaff } from "./staff-access";

const searchApp = z.enum([
  "one_drive",
  "outlook",
  "slack",
  "microsoft_teams",
  "jira",
]);
const connectionApp = z.enum(["gmail", ...searchApp.options]);
const connectedAccountId = z.string().min(1).max(200);
const apolloSeniorities = [
  "owner",
  "founder",
  "c_suite",
  "partner",
  "vp",
  "head",
  "director",
  "manager",
  "senior",
  "entry",
  "intern",
] as const;

export class QmInvalidInputError extends Error {
  readonly fields: string[];
  readonly allowedValues?: { seniorities: readonly string[] };

  constructor(error: z.ZodError) {
    super("QM_INVALID_INPUT");
    this.name = "QmInvalidInputError";
    this.fields = [
      ...new Set(
        error.issues
          .map((issue) => String(issue.path[0] ?? "request"))
          .filter((field) => field.length <= 64),
      ),
    ].slice(0, 8);
    if (this.fields.includes("seniorities"))
      this.allowedValues = { seniorities: apolloSeniorities };
  }
}

const apolloSearch = z
  .object({
    operation: z.literal("apollo_search"),
    idempotencyKey: z.string().uuid(),
    query: z.string().trim().min(2).max(160).optional(),
    titles: z.array(z.string().trim().min(2).max(120)).min(1).max(8).optional(),
    locations: z.array(z.string().trim().min(2).max(120)).max(6).optional(),
    organizationLocations: z
      .array(z.string().trim().min(2).max(120))
      .max(6)
      .optional(),
    seniorities: z
      .array(
        z.enum(apolloSeniorities),
      )
      .max(11)
      .optional(),
    includeSimilarTitles: z.boolean().optional(),
    employeeCountMin: z.number().int().min(1).max(1_000_000).optional(),
    employeeCountMax: z.number().int().min(1).max(1_000_000).optional(),
    perPage: z.number().int().min(1).max(10).optional(),
  })
  .strict()
  .refine((input) => Boolean(input.query) || Boolean(input.titles?.length), {
    message: "Provide at least one job title or keyword",
  })
  .refine(
    (input) =>
      input.employeeCountMin == null ||
      input.employeeCountMax == null ||
      input.employeeCountMin <= input.employeeCountMax,
    { message: "Company size minimum cannot exceed maximum" },
  );

const inputSchema = z.union([
  z.object({ operation: z.literal("connections_list") }).strict(),
  z.object({ operation: z.literal("apollo_connection") }).strict(),
  z.object({ operation: z.literal("connection"), app: connectionApp }).strict(),
  z
    .object({
      operation: z.literal("connected_search"),
      app: searchApp,
      connectedAccountId,
      query: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  z
    .object({ operation: z.literal("gmail_profile"), connectedAccountId })
    .strict(),
  apolloSearch,
  z
    .object({
      operation: z.literal("apollo_search_status"),
      idempotencyKey: z.string().uuid(),
    })
    .strict(),
  z.object({ operation: z.literal("apollo_latest_search") }).strict(),
  z.object({ operation: z.literal("sales_digest") }).strict(),
  z
    .object({
      operation: z.literal("google_maps_search"),
      q: z.string().trim().min(2).max(200),
      ll: z.string().trim().max(100).optional(),
      start: z.number().int().min(0).max(20).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("research_list"),
      state: z
        .enum(["researched", "approved", "rejected", "rework"])
        .optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("contact_research_list"),
      companyResearchId: z.string().optional(),
      state: z.enum(["found", "approved", "rejected", "rework"]).optional(),
    })
    .strict(),
  z
    .object({ operation: z.literal("deal_summary"), dealId: z.string().uuid() })
    .strict(),
  z
    .object({
      operation: z.literal("account_summary"),
      companyId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("next_best_action"),
      dealId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("draft_outreach"),
      dealId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("linkedin_manual_draft"),
      dealId: z.string().uuid(),
      kind: z.enum(["connect", "followup"]).default("connect"),
    })
    .strict(),
]);

function context(user: SessionUser) {
  return {
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
    clientId: null,
  };
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  const normalized = (values: readonly string[]) => [...new Set(values)].sort();
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

function artifact(item: OutreachItem) {
  return {
    id: item.id,
    version: item.updatedAt,
    hash: outreachSnapshotHash(item),
    channel: item.channel,
    recipient: item.recipient,
    subject: item.subject,
    body: item.body,
    state: item.state,
    nextLinks: [
      { href: `/crm/outreach?id=${item.id}`, label: "Review outreach draft" },
    ],
    review: { kind: "hrmny.sales.outreach" as const, id: item.id },
  };
}

export async function runQmOsTool(token: string, raw: unknown) {
  if (process.env.QM_OS_TOOLS_ENABLED !== "1")
    throw new Error("QM_OS_TOOLS_NOT_ENABLED");
  const user = await qmStaff(token);
  if (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { operation?: unknown }).operation === "apollo_search"
  ) {
    const parsed = apolloSearch.safeParse(raw);
    if (!parsed.success) throw new QmInvalidInputError(parsed.error);
  }
  const input = inputSchema.parse(raw);
  const ctx = context(user);
  const caller = createCaller(ctx);
  let result: unknown;
  let usedConnection:
    { app: z.infer<typeof connectionApp>; id: string } | undefined;
  let createdDraft: { id: string; version: string; hash: string } | undefined;
  let usedMaps = false;
  let usedSales = false;

  if (input.operation === "connections_list") {
    const [businessResult, managedResult, workResult] =
      await Promise.allSettled([
        caller.connections.list(),
        caller.connections.managedAccounts(),
        caller.connections.workApps(),
      ]);
    const business =
      businessResult.status === "fulfilled" ? businessResult.value : [];
    const managed =
      managedResult.status === "fulfilled" ? managedResult.value : [];
    const work =
      workResult.status === "fulfilled" ? workResult.value : { apps: [] };
    result = {
      availability: {
        business:
          businessResult.status === "fulfilled" ? "available" : "unavailable",
        managed:
          managedResult.status === "fulfilled" ? "available" : "unavailable",
        work: workResult.status === "fulfilled" ? "available" : "unavailable",
      },
      business: business.map((item) => ({
        app: item.toolkit,
        connected: item.status === "connected",
        status: item.status,
        supportedOperations:
          item.toolkit === "apollo"
            ? ["apollo_search", "apollo_search_status", "apollo_latest_search"]
            : [],
      })),
      managed: managed.map((item) => ({
        app: item.toolkit,
        connectedAccountId: item.connectedAccountId,
        status: item.status,
        statusReason: item.statusReason,
        supportedOperations: [],
      })),
      work: work.apps.map((item) => ({
        app: item.toolkit,
        connected: item.connected,
        connectedAccountId: item.connectedAccountId,
        status: item.connectionStatus,
        supportedOperations:
          item.toolkit === "gmail"
            ? ["gmail_profile"]
            : searchApp.options.includes(
                  item.toolkit as z.infer<typeof searchApp>,
                )
              ? ["connected_search"]
              : [],
      })),
      usage:
        "Use only supportedOperations shown for each app. Connected personal tools with an empty list are visible for account management but are not callable from native chat.",
      nextLinks: [
        { href: "/settings/connections", label: "Manage connections" },
      ],
    };
  } else if (input.operation === "apollo_connection") {
    usedSales = true;
    result = await caller.salesOs.apollo.connection();
  } else if (
    input.operation === "connection" ||
    input.operation === "connected_search" ||
    input.operation === "gmail_profile"
  ) {
    const app = input.operation === "gmail_profile" ? "gmail" : input.app;
    const selectedId =
      input.operation === "connection" ? undefined : input.connectedAccountId;
    const verified = await getVerifiedWorkAppConnection(user.employeeId, app, {
      ...ctx,
      connectedAccountId: selectedId,
    });
    if (!verified) {
      if (input.operation !== "connection")
        throw new Error("QM_CONNECTION_UNAVAILABLE");
      result = {
        app,
        connected: false,
        nextLinks: [
          { href: "/settings/connections", label: "Manage connections" },
        ],
      };
    } else {
      usedConnection = { app, id: verified.account.id };
      if (input.operation === "connection") {
        result = {
          app,
          connected: true,
          connectedAccountId: verified.account.id,
        };
      } else if (input.operation === "connected_search") {
        result = await searchComposioConnectedData({
          client: verified.client,
          connectedAccountId: verified.account.id,
          app: input.app,
          query: input.query,
        });
      } else {
        const response = await verified.client.proxy({
          connectedAccountId: verified.account.id,
          endpoint:
            "https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress",
          method: "GET",
        });
        if (response.status !== 200)
          throw new Error("QM_CONNECTION_UNAVAILABLE");
        const profile = z
          .object({ emailAddress: z.string().email() })
          .parse(response.data);
        result = {
          app,
          connectedAccountId: verified.account.id,
          emailAddress: profile.emailAddress,
        };
      }
    }
  } else {
    usedSales = true;
    switch (input.operation) {
      case "apollo_search": {
        const { operation: _operation, ...query } = input;
        result = await caller.salesOs.apollo.search(query);
        break;
      }
      case "apollo_search_status":
        result = await caller.salesOs.apollo.searchStatus({
          idempotencyKey: input.idempotencyKey,
        });
        break;
      case "apollo_latest_search":
        result = await caller.salesOs.apollo.latestSearch();
        break;
      case "sales_digest":
        result = await caller.salesOs.digest();
        break;
      case "google_maps_search": {
        const salesRole = user.roles.some((role) =>
          ["partner", "director", "am", "account_manager"].includes(role),
        );
        if (
          !salesRole ||
          !(await featureEnabled("crm.workspace", {
            userId: user.employeeId,
            roles: user.roles,
          }))
        )
          throw new Error("QM_SALES_ACCESS_DENIED");
        result = await searchGoogleMapsDiscovery({
          q: input.q,
          ...(input.ll ? { ll: input.ll } : {}),
          ...(input.start !== undefined ? { start: input.start } : {}),
        });
        usedMaps = true;
        break;
      }
      case "research_list":
        result = await caller.salesOs.research.list(
          input.state ? { state: input.state } : undefined,
        );
        break;
      case "contact_research_list":
        result = await caller.salesOs.contacts.list({
          ...(input.companyResearchId
            ? { companyResearchId: input.companyResearchId }
            : {}),
          ...(input.state ? { state: input.state } : {}),
        });
        break;
      case "deal_summary":
        result = await caller.crmAi.dealSummary({ dealId: input.dealId });
        break;
      case "account_summary":
        result = await caller.crmAi.accountSummary({
          companyId: input.companyId,
        });
        break;
      case "next_best_action":
        result = await caller.crmAi.nextBestAction({ dealId: input.dealId });
        break;
      case "draft_outreach": {
        const draft = await caller.crmAi.draftOutreach({
          dealId: input.dealId,
        });
        const exact = artifact(draft.output);
        createdDraft = exact;
        result = { artifact: exact, review: exact.review };
        break;
      }
      case "linkedin_manual_draft": {
        // The broker accepts no LinkedIn feed/profile content. Existing CRM data
        // and the saved source-backed brief are the only drafting context.
        const draft = await caller.leadgen.outreach.draft({
          dealId: input.dealId,
          channel:
            input.kind === "followup"
              ? "linkedin_followup"
              : "linkedin_connect",
        });
        const openUrl = linkedinProfileUrl(
          draft.linkedinUrl ?? draft.recipient,
        );
        if (!openUrl) throw new Error("QM_LINKEDIN_PROFILE_UNAVAILABLE");
        const exact = artifact(draft);
        createdDraft = exact;
        result = {
          artifact: exact,
          review: exact.review,
          openUrl,
          delivery: "manual",
          provenance: "crm_and_saved_research_only",
        };
        break;
      }
    }
  }

  const current = await qmStaff(token);
  if (
    current.employeeId !== user.employeeId ||
    !sameStrings(current.roles, user.roles) ||
    !sameStrings(current.permissions, user.permissions) ||
    process.env.QM_OS_TOOLS_ENABLED !== "1"
  )
    throw new Error("QM_ACCESS_CHANGED");
  if (
    usedConnection &&
    !(await getVerifiedWorkAppConnection(
      current.employeeId,
      usedConnection.app,
      {
        ...context(current),
        connectedAccountId: usedConnection.id,
      },
    ))
  )
    throw new Error("QM_CONNECTION_CHANGED");
  if (
    usedSales &&
    !(await featureEnabled("crm.workspace", {
      userId: current.employeeId,
      roles: current.roles,
    }))
  )
    throw new Error("QM_SALES_ACCESS_CHANGED");
  if (
    usedMaps &&
    (!current.roles.some((role) =>
      ["partner", "director", "am", "account_manager"].includes(role),
    ) ||
      !(await featureEnabled("crm.workspace", {
        userId: current.employeeId,
        roles: current.roles,
      })))
  )
    throw new Error("QM_SALES_ACCESS_CHANGED");
  if (createdDraft) {
    const currentDraft = await getOutreach(createdDraft.id);
    if (
      !currentDraft ||
      currentDraft.state !== "draft" ||
      artifact(currentDraft).version !== createdDraft.version ||
      artifact(currentDraft).hash !== createdDraft.hash
    )
      throw new Error("QM_DRAFT_CHANGED");
  }
  return result;
}
