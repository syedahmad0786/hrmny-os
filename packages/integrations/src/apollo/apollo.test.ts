import { describe, expect, it } from "vitest";
import {
  createApolloMock,
  createHunterMock,
  normalizeApolloPerson,
} from "../index";

describe("Apollo + Hunter mock adapters", () => {
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
});
