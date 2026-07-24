import { Composio } from "@composio/core";
import { z } from "zod";

const connectedAccountSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    toolkit: z.object({ slug: z.string().min(1) }),
    user_id: z.string().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    is_disabled: z.boolean().optional(),
    status_reason: z.string().nullable().optional(),
  })
  .passthrough();

const connectedAccountListSchema = z
  .object({
    items: z.array(connectedAccountSchema),
    next_cursor: z.string().nullable().optional(),
  })
  .passthrough();

const authConfigSchema = z
  .object({
    id: z.string().min(1),
    toolkit: z.object({ slug: z.string().min(1) }),
    name: z.string().min(1),
    auth_scheme: z.string().min(1),
    is_composio_managed: z.boolean(),
    status: z.string().min(1),
  })
  .passthrough();

const authConfigListSchema = z
  .object({
    items: z.array(authConfigSchema),
    next_cursor: z.string().nullable().optional(),
  })
  .passthrough();

const connectLinkSchema = z
  .object({
    redirect_url: z.string().url(),
    connected_account_id: z.string().min(1),
    expires_at: z.string().min(1),
  })
  .passthrough();

const proxyResponseSchema = z
  .object({
    status: z.number(),
    data: z.unknown(),
    headers: z.record(z.string()).nullable().optional(),
  })
  .passthrough();

export type ComposioConnectedAccount = z.infer<typeof connectedAccountSchema>;
export type ComposioAuthConfig = z.infer<typeof authConfigSchema>;
export type ComposioConnectLink = z.infer<typeof connectLinkSchema>;

export type ComposioManagedToolkit = {
  name: string;
  slug: string;
  description: string | null;
  logo: string | null;
};

export class ComposioApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "ComposioApiError";
  }
}

export type ComposioLiveClient = {
  listManagedToolkits(): Promise<ComposioManagedToolkit[]>;
  authorize(userId: string, toolkitSlug: string): Promise<{
    id: string;
    redirectUrl: string;
  }>;
  listUserConnectedAccounts(userId: string): Promise<ComposioConnectedAccount[]>;
  disconnect(connectedAccountId: string): Promise<void>;
  listConnectedAccounts(input?: {
    toolkit?: string;
    statuses?: readonly string[];
    userId?: string;
  }): Promise<ComposioConnectedAccount[]>;
  listAuthConfigs(input?: {
    toolkits?: readonly string[];
  }): Promise<ComposioAuthConfig[]>;
  createConnectLink(input: {
    authConfigId: string;
    userId: string;
    callbackUrl?: string;
  }): Promise<ComposioConnectLink>;
  deleteConnectedAccount(input: {
    connectedAccountId: string;
    revokeOnDelete?: boolean;
  }): Promise<void>;
  proxy<T = unknown>(input: {
    connectedAccountId: string;
    endpoint: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: Record<string, unknown>;
    parameters?: Array<{
      name: string;
      value: string;
      in: "header" | "query";
    }>;
  }): Promise<{ status: number; data: T; headers: Record<string, string> }>;
};

export function createComposioLive(input: {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): ComposioLiveClient {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("Composio API key is required");
  const baseUrl = (
    input.baseUrl ?? "https://backend.composio.dev/api/v3.1"
  ).replace(/\/$/, "");
  const fetchImpl = input.fetchImpl ?? fetch;
  const sdk = new Composio({ apiKey });

  async function request(path: string, init?: RequestInit) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": apiKey,
        ...init?.headers,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? JSON.stringify(payload.error)
          : `Composio request failed (${response.status})`;
      throw new ComposioApiError(message, response.status);
    }
    return payload;
  }

  return {
    async listManagedToolkits() {
      const toolkits = await sdk.toolkits.get({
        managedBy: "composio",
        sortBy: "alphabetically",
        limit: 1000,
      });
      return toolkits
        .filter((toolkit) => toolkit.composioManagedAuthSchemes?.length)
        .map((toolkit) => ({
          name: toolkit.name,
          slug: toolkit.slug,
          description: toolkit.meta.description ?? null,
          logo: toolkit.meta.logo ?? null,
        }));
    },

    async authorize(userId, toolkitSlug) {
      const request = await sdk.toolkits.authorize(userId, toolkitSlug);
      if (!request.redirectUrl) {
        throw new Error("Composio did not return an authorization URL");
      }
      return {
        id: request.id,
        redirectUrl: request.redirectUrl,
      };
    },

    async listUserConnectedAccounts(userId) {
      const accounts: ComposioConnectedAccount[] = [];
      let cursor: string | undefined;
      do {
        const page = await sdk.connectedAccounts.list({
          userIds: [userId],
          accountType: "ALL",
          cursor,
          limit: 100,
        });
        accounts.push(
          ...page.items.map((account) => ({
            id: account.id,
            status: account.status,
            toolkit: account.toolkit,
            user_id: userId,
            created_at: account.createdAt,
            updated_at: account.updatedAt,
            is_disabled: account.isDisabled,
            status_reason: account.statusReason,
          })),
        );
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return accounts;
    },

    async disconnect(connectedAccountId) {
      await sdk.connectedAccounts.delete(connectedAccountId);
    },

    async listConnectedAccounts(filters = {}) {
      const items: ComposioConnectedAccount[] = [];
      let cursor: string | undefined;
      do {
        const query = new URLSearchParams({
          limit: "100",
          account_type: "ALL",
        });
        if (filters.toolkit) query.append("toolkit_slugs", filters.toolkit);
        for (const status of filters.statuses ?? [])
          query.append("statuses", status);
        if (filters.userId) query.append("user_ids", filters.userId);
        if (cursor) query.set("cursor", cursor);
        const page = connectedAccountListSchema.parse(
          await request(`/connected_accounts?${query}`),
        );
        items.push(...page.items);
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      return items;
    },

    async listAuthConfigs(filters = {}) {
      const items: ComposioAuthConfig[] = [];
      let cursor: string | undefined;
      do {
        const query = new URLSearchParams({ limit: "1000" });
        if (filters.toolkits?.length)
          query.set("toolkit_slug", filters.toolkits.join(","));
        if (cursor) query.set("cursor", cursor);
        const page = authConfigListSchema.parse(
          await request(`/auth_configs?${query}`),
        );
        items.push(...page.items);
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      return items;
    },

    async createConnectLink(linkInput) {
      return connectLinkSchema.parse(
        await request("/connected_accounts/link", {
          method: "POST",
          body: JSON.stringify({
            auth_config_id: linkInput.authConfigId,
            user_id: linkInput.userId,
            callback_url: linkInput.callbackUrl,
          }),
        }),
      );
    },

    async deleteConnectedAccount(deleteInput) {
      const query = new URLSearchParams({
        revoke_on_delete: String(deleteInput.revokeOnDelete ?? true),
      });
      await request(
        `/connected_accounts/${encodeURIComponent(deleteInput.connectedAccountId)}?${query}`,
        { method: "DELETE" },
      );
    },

    async proxy<T>(proxyInput: {
      connectedAccountId: string;
      endpoint: string;
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      body?: Record<string, unknown>;
      parameters?: Array<{
        name: string;
        value: string;
        in: "header" | "query";
      }>;
    }) {
      const result = proxyResponseSchema.parse(
        await request("/tools/execute/proxy", {
          method: "POST",
          body: JSON.stringify({
            connected_account_id: proxyInput.connectedAccountId,
            endpoint: proxyInput.endpoint,
            method: proxyInput.method ?? "GET",
            body: proxyInput.body,
            parameters: proxyInput.parameters,
          }),
        }),
      );
      if (result.status < 200 || result.status >= 300) {
        throw new ComposioApiError(
          `Connected service rejected the request (${result.status})`,
          result.status,
          result.data,
        );
      }
      return {
        status: result.status,
        data: result.data as T,
        headers: result.headers ?? {},
      };
    },
  };
}
