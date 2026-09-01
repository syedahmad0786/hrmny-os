import { describe, expect, it } from "vitest";
import {
  APOLLO_SEARCH_SESSION_KEY,
  clearPendingApolloSearch,
  isCurrentApolloSearchOperation,
  LEGACY_APOLLO_SEARCH_SESSION_KEY,
  persistPendingApolloSearch,
  restorePendingApolloSearch,
  type PendingApolloSearch,
} from "./apollo-search-session";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

const partnerId = "c0000000-0000-4000-8000-000000000001";
const amId = "c0000000-0000-4000-8000-000000000002";
const pending: PendingApolloSearch = {
  idempotencyKey: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  query: "hospitality",
  titles: ["Marketing Director"],
  perPage: 8,
};

describe("Apollo pending-search browser scope", () => {
  it("restores only the verified principal's pending request", () => {
    const storage = memoryStorage();
    persistPendingApolloSearch(storage, partnerId, pending);

    expect(restorePendingApolloSearch(storage, partnerId)).toEqual(pending);
  });

  it("deletes a prior principal's pending request on account switch", () => {
    const storage = memoryStorage();
    persistPendingApolloSearch(storage, partnerId, pending);

    expect(restorePendingApolloSearch(storage, amId)).toBeNull();
    expect(storage.getItem(APOLLO_SEARCH_SESSION_KEY)).toBeNull();
  });

  it("deletes the unsafe legacy unscoped payload without restoring it", () => {
    const storage = memoryStorage();
    storage.setItem(LEGACY_APOLLO_SEARCH_SESSION_KEY, JSON.stringify(pending));

    expect(restorePendingApolloSearch(storage, partnerId)).toBeNull();
    expect(storage.getItem(LEGACY_APOLLO_SEARCH_SESSION_KEY)).toBeNull();
  });

  it("removes corrupt scoped state instead of submitting it", () => {
    const storage = memoryStorage();
    storage.setItem(
      APOLLO_SEARCH_SESSION_KEY,
      JSON.stringify({ principalId: partnerId, version: 2, titles: [] }),
    );

    expect(restorePendingApolloSearch(storage, partnerId)).toBeNull();
    expect(storage.getItem(APOLLO_SEARCH_SESSION_KEY)).toBeNull();
  });

  it("cannot let an old completion clear another request or principal", () => {
    const storage = memoryStorage();
    persistPendingApolloSearch(storage, partnerId, pending);

    clearPendingApolloSearch(
      storage,
      partnerId,
      "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
    );
    expect(storage.getItem(APOLLO_SEARCH_SESSION_KEY)).not.toBeNull();
    clearPendingApolloSearch(storage, amId, pending.idempotencyKey);
    expect(storage.getItem(APOLLO_SEARCH_SESSION_KEY)).not.toBeNull();
    clearPendingApolloSearch(storage, partnerId, pending.idempotencyKey);
    expect(storage.getItem(APOLLO_SEARCH_SESSION_KEY)).toBeNull();
  });

  it("rejects stale callbacks after either the principal or request changes", () => {
    const active = {
      principalId: partnerId,
      idempotencyKey: pending.idempotencyKey,
    };

    expect(
      isCurrentApolloSearchOperation(active, partnerId, pending.idempotencyKey),
    ).toBe(true);
    expect(
      isCurrentApolloSearchOperation(active, amId, pending.idempotencyKey),
    ).toBe(false);
    expect(
      isCurrentApolloSearchOperation(
        active,
        partnerId,
        "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
      ),
    ).toBe(false);
    expect(
      isCurrentApolloSearchOperation(null, partnerId, pending.idempotencyKey),
    ).toBe(false);
  });

  it("fails closed when browser storage access throws", () => {
    const getFailure = {
      getItem: () => {
        throw new Error("blocked get");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const setFailure = {
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked set");
      },
      removeItem: () => undefined,
    };
    const removeFailure = {
      getItem: () => JSON.stringify(pending),
      setItem: () => undefined,
      removeItem: () => {
        throw new Error("blocked remove");
      },
    };

    expect(() =>
      restorePendingApolloSearch(getFailure, partnerId),
    ).not.toThrow();
    expect(restorePendingApolloSearch(getFailure, partnerId)).toBeNull();
    expect(() =>
      restorePendingApolloSearch(removeFailure, partnerId),
    ).not.toThrow();
    expect(restorePendingApolloSearch(removeFailure, partnerId)).toBeNull();
    expect(persistPendingApolloSearch(setFailure, partnerId, pending)).toBe(
      false,
    );
    expect(clearPendingApolloSearch(getFailure, partnerId)).toBe(false);
  });
});
