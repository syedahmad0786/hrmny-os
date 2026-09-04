export const APOLLO_SEARCH_SESSION_KEY = "hrmny.apollo-search.pending.v2";
export const LEGACY_APOLLO_SEARCH_SESSION_KEY =
  "hrmny.apollo-search.pending.v1";

export type ApolloSearchSeniority =
  | "owner"
  | "founder"
  | "c_suite"
  | "partner"
  | "vp"
  | "head"
  | "director"
  | "manager"
  | "senior"
  | "entry"
  | "intern";
export type ApolloSearchEmailStatus =
  "verified" | "unverified" | "likely to engage" | "unavailable";

export type PendingApolloSearch = {
  idempotencyKey: string;
  query?: string;
  titles: string[];
  locations?: string[];
  organizationLocations?: string[];
  seniorities?: ApolloSearchSeniority[];
  emailStatuses?: ApolloSearchEmailStatus[];
  technologyIds?: string[];
  includeSimilarTitles?: boolean;
  employeeCountMin?: number;
  employeeCountMax?: number;
  perPage: number;
};

export type ActiveApolloSearch = {
  principalId: string;
  idempotencyKey: string;
};

type StoredPendingApolloSearch = PendingApolloSearch & {
  principalId: string;
  version: 2;
};

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validStringList(
  value: unknown,
  maxItems: number,
  maxLength: number,
): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= maxItems &&
      value.every(
        (item) =>
          typeof item === "string" &&
          item.length >= 1 &&
          item.length <= maxLength,
      ))
  );
}

function validEmployeeCount(value: unknown): boolean {
  return (
    value === undefined ||
    (Number.isInteger(value) &&
      Number(value) >= 1 &&
      Number(value) <= 1_000_000)
  );
}

function parseStoredPendingSearch(
  raw: string,
): StoredPendingApolloSearch | null {
  try {
    const value = JSON.parse(raw) as Partial<StoredPendingApolloSearch>;
    if (
      value.version !== 2 ||
      typeof value.principalId !== "string" ||
      value.principalId.length === 0 ||
      typeof value.idempotencyKey !== "string" ||
      !UUID_PATTERN.test(value.idempotencyKey) ||
      !Array.isArray(value.titles) ||
      value.titles.length < 1 ||
      value.titles.length > 8 ||
      !value.titles.every(
        (item) =>
          typeof item === "string" && item.length >= 2 && item.length <= 120,
      ) ||
      !Number.isInteger(value.perPage) ||
      value.perPage! < 1 ||
      value.perPage! > 10 ||
      (value.query !== undefined &&
        (typeof value.query !== "string" ||
          value.query.length < 2 ||
          value.query.length > 160)) ||
      !validStringList(value.locations, 6, 120) ||
      !validStringList(value.organizationLocations, 6, 120) ||
      !validStringList(value.seniorities, 11, 20) ||
      !validStringList(value.emailStatuses, 4, 30) ||
      !validStringList(value.technologyIds, 10, 80) ||
      (value.includeSimilarTitles !== undefined &&
        typeof value.includeSimilarTitles !== "boolean") ||
      !validEmployeeCount(value.employeeCountMin) ||
      !validEmployeeCount(value.employeeCountMax) ||
      (value.employeeCountMin !== undefined &&
        value.employeeCountMax !== undefined &&
        value.employeeCountMin > value.employeeCountMax)
    ) {
      return null;
    }
    return value as StoredPendingApolloSearch;
  } catch {
    return null;
  }
}

export function restorePendingApolloSearch(
  storage: SessionStorageLike,
  principalId: string,
): PendingApolloSearch | null {
  let raw: string | null;
  try {
    storage.removeItem(LEGACY_APOLLO_SEARCH_SESSION_KEY);
    raw = storage.getItem(APOLLO_SEARCH_SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  const stored = parseStoredPendingSearch(raw);
  if (!stored || stored.principalId !== principalId) {
    try {
      storage.removeItem(APOLLO_SEARCH_SESSION_KEY);
    } catch {
      // The payload is still rejected even when browser storage cannot mutate.
    }
    return null;
  }
  return {
    idempotencyKey: stored.idempotencyKey,
    query: stored.query,
    titles: [...stored.titles],
    locations: stored.locations ? [...stored.locations] : undefined,
    organizationLocations: stored.organizationLocations
      ? [...stored.organizationLocations]
      : undefined,
    seniorities: stored.seniorities ? [...stored.seniorities] : undefined,
    emailStatuses: stored.emailStatuses ? [...stored.emailStatuses] : undefined,
    technologyIds: stored.technologyIds ? [...stored.technologyIds] : undefined,
    includeSimilarTitles: stored.includeSimilarTitles,
    employeeCountMin: stored.employeeCountMin,
    employeeCountMax: stored.employeeCountMax,
    perPage: stored.perPage,
  };
}

export function persistPendingApolloSearch(
  storage: SessionStorageLike,
  principalId: string,
  pending: PendingApolloSearch,
): boolean {
  const stored: StoredPendingApolloSearch = {
    ...pending,
    principalId,
    version: 2,
  };
  try {
    storage.removeItem(LEGACY_APOLLO_SEARCH_SESSION_KEY);
    storage.setItem(APOLLO_SEARCH_SESSION_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingApolloSearch(
  storage: SessionStorageLike,
  principalId: string,
  expectedIdempotencyKey?: string,
): boolean {
  try {
    const raw = storage.getItem(APOLLO_SEARCH_SESSION_KEY);
    if (!raw) return true;
    const stored = parseStoredPendingSearch(raw);
    if (!stored) {
      storage.removeItem(APOLLO_SEARCH_SESSION_KEY);
      return true;
    }
    if (
      stored.principalId === principalId &&
      (!expectedIdempotencyKey ||
        stored.idempotencyKey === expectedIdempotencyKey)
    ) {
      storage.removeItem(APOLLO_SEARCH_SESSION_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

export function isCurrentApolloSearchOperation(
  active: ActiveApolloSearch | null,
  principalId: string | null,
  idempotencyKey: string | null | undefined,
): boolean {
  return Boolean(
    active &&
    principalId &&
    idempotencyKey &&
    active.principalId === principalId &&
    active.idempotencyKey === idempotencyKey,
  );
}
