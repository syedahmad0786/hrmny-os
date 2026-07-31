import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/cron/jobs/route";

describe("scheduled-job cron boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects missing and incorrect CRON_SECRET before database access", async () => {
    vi.stubEnv("CRON_SECRET", "m1-test-secret");
    const missing = await GET(
      new Request("https://hrmny.example/api/cron/jobs"),
    );
    expect(missing.status).toBe(401);

    const incorrect = await GET(
      new Request("https://hrmny.example/api/cron/jobs", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(incorrect.status).toBe(401);
  });
});
