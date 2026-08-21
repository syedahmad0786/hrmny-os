/**
 * Live LinkedIn organic post publisher via Composio.
 *
 * Uses LINKEDIN_GET_MY_INFO (author URN) + LINKEDIN_CREATE_LINKED_IN_POST
 * (commentary). Callers must gate with HITL (approved → published) and an
 * ACTIVE LinkedIn connected account — never auto-publish.
 */

import type {
  SocialChannel,
  SocialPublishAdapter,
  SocialPublishResult,
} from "../contracts";
import type { ComposioLiveClient } from "./live";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Prefer nested `data` / `response_data` envelopes from Composio tool results. */
export function unwrapComposioToolData(
  payload: unknown,
): Record<string, unknown> | null {
  const root = asRecord(payload);
  if (!root) return null;
  for (const key of ["data", "response_data", "response"] as const) {
    const nested = asRecord(root[key]);
    if (nested) return nested;
  }
  return root;
}

/** Build `urn:li:person:{id}` from LINKEDIN_GET_MY_INFO result. */
export function authorUrnFromLinkedInProfile(payload: unknown): string | null {
  const data = unwrapComposioToolData(payload) ?? asRecord(payload);
  if (!data) return null;
  const id =
    typeof data.id === "string"
      ? data.id.trim()
      : typeof data.sub === "string"
        ? data.sub.trim()
        : "";
  if (!id) return null;
  if (id.startsWith("urn:li:")) return id;
  return `urn:li:person:${id}`;
}

export function externalIdFromLinkedInPost(payload: unknown): string | null {
  const data = unwrapComposioToolData(payload) ?? asRecord(payload);
  if (!data) return null;
  for (const key of ["id", "postId", "post_id", "urn"] as const) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function createLinkedInSocialPublishAdapter(opts: {
  client: Pick<ComposioLiveClient, "executeTool">;
  connectedAccountId: string;
}): SocialPublishAdapter {
  let seq = 0;
  return {
    mode: "live",
    async listChannels(): Promise<SocialChannel[]> {
      return ["linkedin"];
    },
    async publishAfterApproval(input): Promise<SocialPublishResult> {
      seq += 1;
      if (input.channel !== "linkedin") {
        throw new Error(
          `LinkedIn publisher does not support channel "${input.channel}"`,
        );
      }
      const commentary = input.content.trim();
      if (!commentary) {
        throw new Error("LinkedIn post copy is empty");
      }

      const connectedAccountId =
        input.connectionId?.trim() || opts.connectedAccountId;

      const me = await opts.client.executeTool({
        connectedAccountId,
        toolSlug: "LINKEDIN_GET_MY_INFO",
      });
      const author = authorUrnFromLinkedInProfile(me);
      if (!author) {
        throw new Error(
          "Could not resolve LinkedIn author URN from LINKEDIN_GET_MY_INFO",
        );
      }

      const post = await opts.client.executeTool({
        connectedAccountId,
        toolSlug: "LINKEDIN_CREATE_LINKED_IN_POST",
        arguments: {
          author,
          commentary,
          visibility: "PUBLIC",
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        },
      });
      const externalId =
        externalIdFromLinkedInPost(post) ?? `li-live-${seq}`;
      return {
        published: true,
        mode: "live",
        externalId,
        channel: "linkedin",
      };
    },
  };
}
