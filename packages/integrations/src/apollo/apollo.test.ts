import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApolloAdapter,
  createApolloLive,
  createApolloMock,
  createHunterMock,
  normalizeApolloPerson,
} from "../index";

describe("Apollo + Hunter mock adapters", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("Apollo mock enriches person", async () => {
    const apollo = createApolloMock();
    const person = await apollo.enrichPerson("alex@democo.example");
    expect(person?.email).toBe("alex@democo.example");
    expect(person?.source).toBe("apollo_mock");
  });

  it("Hunter mock verifies deliverable emails", async () => {
    const hunter = createHunterMock();
    const ok = await hunter.verifyEmail("alex@democo.example");
    expect(ok.emailVerified).toBe(true);
    const bad = await hunter.verifyEmail("bad@example.invalid");
    expect(bad.emailVerified).toBe(false);
  });

  it("normalizeApolloPerson maps snake_case live payloads", () => {
    const normalized = normalizeApolloPerson("ceo@acme.example", {
      email: "ceo@acme.example",
      first_name: "Sam",
      last_name: "Lee",
      title: "CEO",
      email_status: "verified",
      organization: { name: "Acme" },
    });
    expect(normalized).toMatchObject({
      email: "ceo@acme.example",
      firstName: "Sam",
      lastName: "Lee",
      title: "CEO",
      organization: "Acme",
      emailStatus: "verified",
      source: "apollo",
    });
  });

  it("does not activate Apollo merely because a credential exists", async () => {
    vi.stubEnv("APOLLO_API_KEY", "connected-not-activated");
    vi.stubEnv("APOLLO_MODE", "");
    const apollo = createApolloAdapter();
    expect((await apollo.enrichPerson("alex@democo.example"))?.source).toBe(
      "apollo_mock",
    );
  });

  it("blocks credit-consuming Apollo calls until billing is approved", async () => {
    const apollo = createApolloLive({
      mode: "live",
      apiKey: "test-key",
      allowPaidOperations: false,
    });
    await expect(apollo.enrichPerson("alex@democo.example")).rejects.toThrow(
      /APOLLO_ALLOW_PAID_OPERATIONS=true/,
    );
    await expect(apollo.searchCompanies("Demo")).rejects.toThrow(
      /APOLLO_ALLOW_PAID_OPERATIONS=true/,
    );
  });
});
