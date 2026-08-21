import { describe, expect, it } from "vitest";
import {
  decideLlmSandbox,
  memorySandboxMetadata,
  roleMayUsePrivilegedWorkspace,
} from "./sandbox";

describe("LLM sandbox", () => {
  it("allows general workspace for any role", () => {
    const decision = decideLlmSandbox({ roles: ["creative"] });
    expect(decision).toEqual({ allowed: true, workspace: "general" });
  });

  it("blocks privileged domains for non-privileged roles", () => {
    const decision = decideLlmSandbox({
      roles: ["creative"],
      domains: ["salary"],
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.workspace).toBe("privileged");
      expect(decision.reason).toMatch(/sandboxed/i);
    }
  });

  it("allows partner into privileged workspace", () => {
    const prev = process.env.OPENROUTER_PRIVILEGED_API_KEY;
    const prevProvider = process.env.LLM_PROVIDER;
    process.env.OPENROUTER_PRIVILEGED_API_KEY = "test-key";
    delete process.env.LLM_PROVIDER;
    expect(roleMayUsePrivilegedWorkspace(["partner"])).toBe(true);
    const decision = decideLlmSandbox({
      roles: ["partner"],
      requestPrivileged: true,
    });
    expect(decision).toEqual({ allowed: true, workspace: "privileged" });
    if (prev !== undefined) process.env.OPENROUTER_PRIVILEGED_API_KEY = prev;
    else delete process.env.OPENROUTER_PRIVILEGED_API_KEY;
    if (prevProvider !== undefined) process.env.LLM_PROVIDER = prevProvider;
  });

  it("tags memory sandbox metadata for client and user", () => {
    expect(
      memorySandboxMetadata({
        clientId: "00000000-0000-4000-8000-0000000000aa",
        employeeId: "00000000-0000-4000-8000-0000000000bb",
      }),
    ).toEqual({
      clientId: "00000000-0000-4000-8000-0000000000aa",
      employeeId: "00000000-0000-4000-8000-0000000000bb",
    });
  });
});
