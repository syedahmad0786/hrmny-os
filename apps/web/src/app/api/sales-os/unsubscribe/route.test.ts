process.env.DATABASE_URL = "";

import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/server/sales-os/replies", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/sales-os/replies")>();
  return { ...actual, honorUnsubscribe: vi.fn(actual.honorUnsubscribe) };
});

import { GET } from "./route";
import {
  createUnsubscribeToken,
  verifyUnsubscribeToken,
} from "@/server/sales-os/compliance";
import { isSuppressed, resetSalesOsStore } from "@/server/sales-os/store";
import { resetIntegrationReceiptMemory } from "@/server/integrations/inbox";
import { honorUnsubscribe } from "@/server/sales-os/replies";

describe("signed one-click unsubscribe", () => {
  beforeEach(() => {
    vi.stubEnv("SALES_UNSUBSCRIBE_SECRET", "test-unsubscribe-secret");
    resetSalesOsStore();
    resetIntegrationReceiptMemory();
    vi.mocked(honorUnsubscribe).mockClear();
  });

  it("honors one recipient once and rejects tampered or expired links", async () => {
    const now = 1_800_000_000;
    const token = createUnsubscribeToken("person@example.com", now);
    expect(verifyUnsubscribeToken(token, now)).toBe("person@example.com");
    expect(verifyUnsubscribeToken(`${token.slice(0, -1)}x`, now)).toBeNull();
    expect(verifyUnsubscribeToken(token, now + 181 * 24 * 60 * 60)).toBeNull();

    const request = new Request(
      `https://hrmny.example/api/sales-os/unsubscribe?token=${encodeURIComponent(token)}`,
    );
    const first = await GET(request);
    const replay = await GET(request);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await first.text()).not.toContain("person@example.com");
    expect(await isSuppressed({ email: "person@example.com" })).toMatchObject({
      reason: "unsubscribe",
    });

    const tampered = await GET(new Request(`${request.url.slice(0, -1)}x`));
    expect(tampered.status).toBe(400);
  });

  it("reports a failed write and safely retries the same signed link", async () => {
    vi.mocked(honorUnsubscribe).mockRejectedValueOnce(
      new Error("temporary store failure"),
    );
    const token = createUnsubscribeToken("retry@example.com");
    const request = new Request(
      `https://hrmny.example/api/sales-os/unsubscribe?token=${encodeURIComponent(token)}`,
    );

    expect((await GET(request)).status).toBe(503);
    expect(await isSuppressed({ email: "retry@example.com" })).toBeNull();
    expect((await GET(request)).status).toBe(200);
    expect(await isSuppressed({ email: "retry@example.com" })).toMatchObject({
      reason: "unsubscribe",
    });
    expect(honorUnsubscribe).toHaveBeenCalledTimes(2);
  });
});
