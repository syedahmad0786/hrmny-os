import { describe, expect, it, vi } from "vitest";
import {
  authorUrnFromLinkedInProfile,
  createLinkedInSocialPublishAdapter,
  externalIdFromLinkedInPost,
} from "./linkedin-publish";
import type { ComposioLiveClient } from "./live";

describe("LinkedIn Composio publish helpers", () => {
  it("builds author URN from profile id", () => {
    expect(authorUrnFromLinkedInProfile({ id: "abc123" })).toBe(
      "urn:li:person:abc123",
    );
    expect(
      authorUrnFromLinkedInProfile({ data: { id: "xyz" } }),
    ).toBe("urn:li:person:xyz");
    expect(
      authorUrnFromLinkedInProfile({ id: "urn:li:person:keep" }),
    ).toBe("urn:li:person:keep");
    expect(authorUrnFromLinkedInProfile({})).toBeNull();
  });

  it("extracts post external id", () => {
    expect(externalIdFromLinkedInPost({ id: "urn:li:share:1" })).toBe(
      "urn:li:share:1",
    );
    expect(
      externalIdFromLinkedInPost({ data: { postId: "post-9" } }),
    ).toBe("post-9");
  });
});

describe("createLinkedInSocialPublishAdapter", () => {
  it("publishes live via GET_MY_INFO then CREATE_LINKED_IN_POST", async () => {
    const executeTool = vi.fn(async (input: { toolSlug: string }) => {
      if (input.toolSlug === "LINKEDIN_GET_MY_INFO") {
        return { id: "person99" };
      }
      if (input.toolSlug === "LINKEDIN_CREATE_LINKED_IN_POST") {
        return { id: "urn:li:share:live-1" };
      }
      throw new Error(`unexpected ${input.toolSlug}`);
    }) as unknown as ComposioLiveClient["executeTool"];

    const adapter = createLinkedInSocialPublishAdapter({
      client: { executeTool },
      connectedAccountId: "conn-li-1",
    });

    const result = await adapter.publishAfterApproval({
      channel: "linkedin",
      content: "Hello from hrmny OS",
    });

    expect(result).toEqual({
      published: true,
      mode: "live",
      externalId: "urn:li:share:live-1",
      channel: "linkedin",
    });
    expect(executeTool).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        connectedAccountId: "conn-li-1",
        toolSlug: "LINKEDIN_GET_MY_INFO",
      }),
    );
    expect(executeTool).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        connectedAccountId: "conn-li-1",
        toolSlug: "LINKEDIN_CREATE_LINKED_IN_POST",
        arguments: expect.objectContaining({
          author: "urn:li:person:person99",
          commentary: "Hello from hrmny OS",
        }),
      }),
    );
  });

  it("fails loud when author cannot be resolved", async () => {
    const executeTool = vi.fn(async () => ({})) as unknown as ComposioLiveClient["executeTool"];
    const adapter = createLinkedInSocialPublishAdapter({
      client: { executeTool },
      connectedAccountId: "conn-li-1",
    });
    await expect(
      adapter.publishAfterApproval({
        channel: "linkedin",
        content: "x",
      }),
    ).rejects.toThrow(/author URN/);
  });

  it("rejects non-linkedin channels", async () => {
    const executeTool = vi.fn() as unknown as ComposioLiveClient["executeTool"];
    const adapter = createLinkedInSocialPublishAdapter({
      client: { executeTool },
      connectedAccountId: "conn-li-1",
    });
    await expect(
      adapter.publishAfterApproval({
        channel: "x",
        content: "nope",
      }),
    ).rejects.toThrow(/does not support channel/);
    expect(executeTool).not.toHaveBeenCalled();
  });
});
