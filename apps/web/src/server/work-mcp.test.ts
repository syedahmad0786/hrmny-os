import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/mcp/work/route";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { clearDemoFeatureOverrides } from "./features";
import { issueWorkApiToken } from "./work-api";
import { createCaller } from "./trpc/root";

function partnerCaller() {
  const user = resolveDevUser("partner");
  return {
    user,
    caller: createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
      clientId: user.clientId,
    }),
  };
}

function request(token: string, body: Record<string, unknown>) {
  return new Request("http://localhost/api/mcp/work", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("Work MCP server", () => {
  beforeEach(clearDemoFeatureOverrides);

  it("exposes only scoped tools and acts with the token owner's access", async () => {
    const { user, caller } = partnerCaller();
    for (const featureKey of ["work.api_webhooks", "work.ai.connectors"])
      await caller.admin.features.setOverride({
        featureKey,
        scopeType: "global",
        scopeKey: "global",
        enabled: true,
        reason: "test",
      });
    const issued = await issueWorkApiToken({
      label: "MCP test",
      scopes: ["projects:read", "tasks:write"],
      expiresAt: null,
      employeeId: user.employeeId,
      employeeName: user.displayName,
    });

    const listed = await POST(
      request(issued.token, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    );
    const listedBody = await listed.json();
    expect(
      listedBody.result.tools.map((tool: { name: string }) => tool.name),
    ).toContain("list_projects");
    expect(
      listedBody.result.tools.map((tool: { name: string }) => tool.name),
    ).not.toContain("add_task_comment");

    const projects = await caller.work.projects.list();
    const called = await POST(
      request(issued.token, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "create_task",
          arguments: {
            projectId: projects[0]!.projectId,
            title: "Created through MCP",
          },
        },
      }),
    );
    const calledBody = await called.json();
    expect(calledBody.result.isError).not.toBe(true);
    expect(calledBody.result.structuredContent.data.title).toBe(
      "Created through MCP",
    );
  });

  it("fails closed when the connector capability is disabled", async () => {
    const { user, caller } = partnerCaller();
    await caller.admin.features.setOverride({
      featureKey: "work.api_webhooks",
      scopeType: "global",
      scopeKey: "global",
      enabled: true,
      reason: "test",
    });
    const issued = await issueWorkApiToken({
      label: "MCP disabled",
      scopes: ["projects:read"],
      expiresAt: null,
      employeeId: user.employeeId,
    });
    expect(
      (
        await POST(
          request(issued.token, {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/list",
          }),
        )
      ).status,
    ).toBe(403);
  });
});
