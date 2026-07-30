import { afterEach, describe, expect, it, vi } from "vitest";

describe("onboarding store memory fallback", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("seeds seven phases and signoff advances the next phase", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AUTH_MODE", "dev");
    const { ensureOnboarding, saveOnboarding, getOnboarding } = await import(
      "./onboarding-store"
    );
    const clientId = "c1000000-0000-4000-8000-0000000000a4";
    const { getDemoStore } = await import("../demo-store");
    getDemoStore().onboarding.delete(clientId);

    const phases = await ensureOnboarding(clientId);
    expect(phases).toHaveLength(7);
    expect(phases[0]?.status).toBe("active");
    expect(phases[1]?.status).toBe("pending");

    phases[0]!.status = "signed_off";
    phases[0]!.signedOffAt = new Date().toISOString();
    phases[0]!.steps = phases[0]!.steps.map((s) => ({ ...s, done: true }));
    phases[1]!.status = "active";
    await saveOnboarding(clientId, phases);

    const again = await getOnboarding(clientId);
    expect(again[0]?.status).toBe("signed_off");
    expect(again[1]?.status).toBe("active");
  });
});
