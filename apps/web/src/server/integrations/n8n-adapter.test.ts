import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: () => null }));

import { createCaller } from "../trpc/root";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import { clearMemoryApiKeys, saveMemoryApiKey } from "./memory-keys";

function partnerCaller() {
  const user = resolveDevUser("partner");
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

describe("resolved n8n adapter", () => {
  afterEach(() => {
    clearMemoryApiKeys();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("automation.smoke stays mock when only a memory n8n key is present", async () => {
    const prevMode = process.env.N8N_MODE;
    delete process.env.N8N_MODE;
    saveMemoryApiKey("n8n", "n8n-e2e-backend-key");

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const smoke = await partnerCaller().automation.smoke();
    expect(smoke.health.mode).toBe("mock");
    expect(smoke.live).toBe(false);
    expect(smoke.workflowCount).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();

    if (prevMode === undefined) delete process.env.N8N_MODE;
    else process.env.N8N_MODE = prevMode;
  });
});
