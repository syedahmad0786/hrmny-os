export const DISCOVERY_VIEWS = [
  "review",
  "programmes",
  "sources",
  "runs",
] as const;

export type DiscoveryView = (typeof DISCOVERY_VIEWS)[number];

export const DISCOVERY_QUEUES = [
  "needs_review",
  "needs_evidence",
  "parked",
  "accepted",
  "rejected",
] as const;

export type DiscoveryQueue = (typeof DISCOVERY_QUEUES)[number];

export type DiscoveryResearchNav = {
  view: DiscoveryView;
  candidateId: string | null;
  programmeId: string | null;
  runId: string | null;
  queue: DiscoveryQueue;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readUuid(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return UUID_RE.test(trimmed) ? trimmed : null;
}

export function parseDiscoveryResearchNav(
  params: URLSearchParams | { get(name: string): string | null },
): DiscoveryResearchNav {
  const viewRaw = params.get("view")?.trim() ?? "";
  const view = (DISCOVERY_VIEWS as readonly string[]).includes(viewRaw)
    ? (viewRaw as DiscoveryView)
    : "review";
  const queueRaw = params.get("queue")?.trim() ?? "";
  const queue = (DISCOVERY_QUEUES as readonly string[]).includes(queueRaw)
    ? (queueRaw as DiscoveryQueue)
    : "needs_review";
  const nav: DiscoveryResearchNav = {
    view,
    candidateId: readUuid(params.get("candidateId")),
    programmeId: readUuid(params.get("programmeId")),
    runId: readUuid(params.get("runId")),
    queue,
  };
  if (nav.view !== "review") {
    nav.candidateId = null;
    nav.queue = "needs_review";
  }
  if (nav.view !== "programmes" && nav.view !== "runs") {
    nav.programmeId = null;
  }
  if (nav.view !== "runs") {
    nav.runId = null;
  }
  return nav;
}

export function buildDiscoveryResearchHref(
  next: Partial<DiscoveryResearchNav> & { view?: DiscoveryView },
  current: DiscoveryResearchNav = {
    view: "review",
    candidateId: null,
    programmeId: null,
    runId: null,
    queue: "needs_review",
  },
) {
  const merged: DiscoveryResearchNav = {
    view: next.view ?? current.view,
    candidateId:
      next.candidateId === undefined ? current.candidateId : next.candidateId,
    programmeId:
      next.programmeId === undefined ? current.programmeId : next.programmeId,
    runId: next.runId === undefined ? current.runId : next.runId,
    queue: next.queue ?? current.queue,
  };

  if (merged.view !== "review") {
    merged.candidateId = null;
    merged.queue = "needs_review";
  }
  if (merged.view !== "programmes" && merged.view !== "runs") {
    merged.programmeId = null;
  }
  if (merged.view !== "runs") {
    merged.runId = null;
  }

  const params = new URLSearchParams();
  if (merged.view !== "review") params.set("view", merged.view);
  if (merged.view === "review" && merged.queue !== "needs_review") {
    params.set("queue", merged.queue);
  }
  if (merged.view === "review" && merged.candidateId) {
    params.set("candidateId", merged.candidateId);
  }
  if (
    (merged.view === "programmes" || merged.view === "runs") &&
    merged.programmeId
  ) {
    params.set("programmeId", merged.programmeId);
  }
  if (merged.view === "runs" && merged.runId) {
    params.set("runId", merged.runId);
  }

  const query = params.toString();
  return query ? `/crm/research?${query}` : "/crm/research";
}

export function safeExternalHttpsUrl(value: string | null | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
