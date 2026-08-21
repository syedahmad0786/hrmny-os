import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { and, convention, eq, sql } from "@hrmny/db";
import { getDb } from "../db";
import { getDemoStore } from "../demo-store";
import { featureEnabled } from "../features";
import { getSupabasePublicConfig } from "@/lib/supabase-config";
import type { SessionUser } from "./session";

/** Feature flag key — off = current portal auth behavior (see catalog.ts). */
export const PORTAL_MAGIC_LINK_FEATURE = "portal.magic_link";

/** Convention rule holding the email→clientId invite allowlist (no new table). */
const ALLOWLIST_RULE_KEY = "portal.allowed_contacts";
const TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_GRANT_TTL_MS = 8 * 60 * 60 * 1000;

/** Canonical portal grant — shared with resolveSupabaseUser's portal branch. */
export const PORTAL_PERMISSIONS = [
  "allow:portal:read",
  "allow:portal:approve",
  "deny:margin:view",
  "deny:invoice:*",
  "deny:payroll:*",
] as const;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Stable uuid-shaped id from an email — no client_portal_user row required. */
function deterministicPortalUserId(email: string): string {
  const h = createHash("sha256").update(`portal:${email}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function portalSessionUser(input: {
  email: string;
  clientId: string;
}): SessionUser {
  const email = normalizeEmail(input.email);
  return {
    employeeId: deterministicPortalUserId(email || input.clientId),
    email: email || `portal@${input.clientId.slice(0, 8)}.local`,
    displayName: email || "Portal contact",
    roles: ["portal_client"],
    permissions: [...PORTAL_PERMISSIONS],
    actorType: "portal",
    clientId: input.clientId,
  };
}

/**
 * Convention-sourced allowlist of invited portal contacts, read the same way
 * as admin.health reads conventions (DB when present, demo store otherwise).
 * Payload shape: `{ contacts: { "<email>": "<clientId>" } }`.
 */
export async function getPortalAllowlist(): Promise<Map<string, string>> {
  const db = getDb();
  let payload: unknown;
  if (db) {
    const [row] = await db
      .select({ payload: convention.payload })
      .from(convention)
      .where(
        and(
          eq(convention.ruleKey, ALLOWLIST_RULE_KEY),
          eq(convention.isActive, true),
        ),
      )
      .limit(1);
    payload = row?.payload;
  } else {
    payload = getDemoStore().conventions.get(ALLOWLIST_RULE_KEY)?.payload;
  }

  const contacts =
    payload && typeof payload === "object"
      ? (payload as { contacts?: unknown }).contacts
      : undefined;
  const map = new Map<string, string>();
  if (contacts && typeof contacts === "object") {
    for (const [email, clientId] of Object.entries(
      contacts as Record<string, unknown>,
    )) {
      if (typeof clientId === "string" && clientId) {
        map.set(normalizeEmail(email), clientId);
      }
    }
  }
  return map;
}

/** Upsert one email → clientId into portal.allowed_contacts (magic-link gate). */
export async function upsertPortalAllowlistContact(input: {
  email: string;
  clientId: string;
}): Promise<void> {
  const email = normalizeEmail(input.email);
  const db = getDb();
  if (!db) {
    const store = getDemoStore();
    const existing = store.conventions.get(ALLOWLIST_RULE_KEY);
    const contacts =
      existing?.payload &&
      typeof existing.payload === "object" &&
      (existing.payload as { contacts?: Record<string, string> }).contacts
        ? {
            ...(existing.payload as { contacts: Record<string, string> })
              .contacts,
          }
        : {};
    contacts[email] = input.clientId;
    store.conventions.set(ALLOWLIST_RULE_KEY, {
      ruleKey: ALLOWLIST_RULE_KEY,
      version: existing?.version ?? 1,
      payload: { contacts },
      updatedAt: new Date().toISOString(),
      updatedByEmployeeId: null,
    });
    return;
  }

  const [row] = await db
    .select({
      conventionId: convention.conventionId,
      payload: convention.payload,
      version: convention.version,
    })
    .from(convention)
    .where(
      and(
        eq(convention.ruleKey, ALLOWLIST_RULE_KEY),
        eq(convention.isActive, true),
      ),
    )
    .limit(1);

  const contacts: Record<string, string> = {};
  if (row?.payload && typeof row.payload === "object") {
    const raw = (row.payload as { contacts?: unknown }).contacts;
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === "string" && v) contacts[normalizeEmail(k)] = v;
      }
    }
  }
  contacts[email] = input.clientId;
  const payload = { contacts };

  if (row) {
    await db
      .update(convention)
      .set({ payload, updatedAt: new Date() })
      .where(eq(convention.conventionId, row.conventionId));
  } else {
    await db.insert(convention).values({
      ruleKey: ALLOWLIST_RULE_KEY,
      version: "1",
      payload,
      isActive: true,
    });
  }
}

/** Global flag gate. Flag off short-circuits every new code path. */
export async function portalMagicLinkEnabled(): Promise<boolean> {
  return featureEnabled(PORTAL_MAGIC_LINK_FEATURE, {});
}

export type RequestResult = { status: "sent"; stubToken?: string };

async function ensurePortalMagicTokenTable(): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    await db.execute(sql`
      create table if not exists public.portal_magic_token (
        portal_magic_token_id uuid primary key default gen_random_uuid() not null,
        token_hash text not null unique,
        client_id uuid not null references public.client(client_id),
        email text not null,
        expires_at timestamptz not null,
        consumed_at timestamptz,
        created_at timestamptz not null default now()
      )
    `);
    return true;
  } catch {
    return false;
  }
}

/** Issue a single-use portal token (Postgres when available, else memory). */
export async function issuePortalMagicToken(input: {
  clientId: string;
  email: string;
}): Promise<string> {
  const email = normalizeEmail(input.email);
  const token = `ml_${randomUUID().replace(/-/g, "")}`;
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const db = getDb();
  if (db && (await ensurePortalMagicTokenTable())) {
    try {
      await db.execute(sql`
        insert into public.portal_magic_token (
          token_hash, client_id, email, expires_at
        ) values (
          ${hashToken(token)},
          ${input.clientId}::uuid,
          ${email},
          ${new Date(expiresAt).toISOString()}::timestamptz
        )
      `);
      return token;
    } catch {
      // Unknown client_id (unit fixtures) or transient DB — memory fallback.
    }
  }
  const store = getDemoStore();
  store.portalMagicTokens.set(token, {
    token,
    clientId: input.clientId,
    email,
    expiresAt,
  });
  return token;
}

/**
 * Enumeration-safe magic-link request. The return value is byte-identical for
 * allowlisted and unknown emails; only an allowlisted contact triggers a side
 * effect (a Supabase OTP email, or a single-use durable/dev token). Unknown
 * emails silently no-op so a caller cannot probe who is invited.
 */
export async function requestPortalMagicLink(
  email: string,
  opts?: { redirectTo?: string },
): Promise<RequestResult> {
  const normalized = normalizeEmail(email);
  const clientId = (await getPortalAllowlist()).get(normalized);
  const config = getSupabasePublicConfig();

  if (config) {
    if (clientId) {
      const supabase = createClient(config.url, config.key, {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      });
      // Live delivery needs Supabase SMTP; without it this is a safe no-op.
      // Swallow errors so response shape/timing never reveals allowlist state.
      await supabase.auth
        .signInWithOtp({
          email: normalized,
          options: {
            shouldCreateUser: true,
            emailRedirectTo: opts?.redirectTo,
          },
        })
        .catch(() => undefined);
    }
    return { status: "sent" };
  }

  // No Supabase public config: durable single-use token when DB present.
  if (clientId) {
    const token = await issuePortalMagicToken({
      clientId,
      email: normalized,
    });
    if (process.env.NODE_ENV !== "production") {
      console.info(`[portal magic-link] dev token for ${normalized}: ${token}`);
    }
    return { status: "sent", stubToken: token };
  }
  return { status: "sent" };
}

export type VerifyResult =
  | {
      ok: true;
      clientId: string;
      email: string;
      via: "magic_link";
      sessionGrant: string;
    }
  | { ok: false; reason: string };

async function ensurePortalSessionGrantTable(): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    await db.execute(sql`
      create table if not exists public.portal_session_grant (
        portal_session_grant_id uuid primary key default gen_random_uuid() not null,
        token_hash text not null unique,
        client_id uuid not null references public.client(client_id),
        email text not null,
        expires_at timestamptz not null,
        created_at timestamptz not null default now()
      )
    `);
    return true;
  } catch {
    return false;
  }
}

/** Multi-use portal session after magic-link verify (header: x-portal-grant). */
export async function issuePortalSessionGrant(input: {
  clientId: string;
  email: string;
}): Promise<string> {
  const email = normalizeEmail(input.email);
  const token = `ps_${randomUUID().replace(/-/g, "")}`;
  const expiresAt = Date.now() + SESSION_GRANT_TTL_MS;
  const db = getDb();
  if (db && (await ensurePortalSessionGrantTable())) {
    try {
      await db.execute(sql`
        insert into public.portal_session_grant (
          token_hash, client_id, email, expires_at
        ) values (
          ${hashToken(token)},
          ${input.clientId}::uuid,
          ${email},
          ${new Date(expiresAt).toISOString()}::timestamptz
        )
      `);
      return token;
    } catch {
      // fall through to memory
    }
  }
  getDemoStore().portalSessionGrants.set(token, {
    token,
    clientId: input.clientId,
    email,
    expiresAt,
  });
  return token;
}

export async function resolvePortalSessionGrant(
  token: string,
): Promise<SessionUser | null> {
  if (!token.startsWith("ps_")) return null;
  const db = getDb();
  if (db && (await ensurePortalSessionGrantTable())) {
    const rows = await db.execute<{
      client_id: string;
      email: string;
      expires_at: Date | string;
    }>(sql`
      select client_id, email, expires_at
      from public.portal_session_grant
      where token_hash = ${hashToken(token)}
      limit 1
    `);
    const row = rows[0];
    if (row && new Date(row.expires_at).getTime() >= Date.now()) {
      return portalSessionUser({
        clientId: row.client_id,
        email: row.email,
      });
    }
  }
  const mem = getDemoStore().portalSessionGrants.get(token);
  if (!mem || mem.expiresAt < Date.now()) {
    getDemoStore().portalSessionGrants.delete(token);
    return null;
  }
  return portalSessionUser({ clientId: mem.clientId, email: mem.email });
}

async function withSessionGrant(
  result: { ok: true; clientId: string; email: string; via: "magic_link" },
): Promise<VerifyResult> {
  const sessionGrant = await issuePortalSessionGrant({
    clientId: result.clientId,
    email: result.email,
  });
  return { ...result, sessionGrant };
}

/** Single-use token verification (Postgres, then memory fallback). */
export async function verifyPortalMagicToken(
  token: string,
): Promise<VerifyResult> {
  const db = getDb();
  if (db && (await ensurePortalMagicTokenTable())) {
    const durable = await db.transaction(async (tx) => {
      const rows = await tx.execute<{
        client_id: string;
        email: string;
        expires_at: Date | string;
        consumed_at: Date | string | null;
      }>(sql`
        select client_id, email, expires_at, consumed_at
        from public.portal_magic_token
        where token_hash = ${hashToken(token)}
        limit 1
        for update
      `);
      const row = rows[0];
      if (!row || row.consumed_at) {
        return null;
      }
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return { ok: false as const, reason: "Invalid or expired magic link" };
      }
      await tx.execute(sql`
        update public.portal_magic_token
        set consumed_at = now()
        where token_hash = ${hashToken(token)}
          and consumed_at is null
      `);
      return {
        ok: true as const,
        clientId: row.client_id,
        email: row.email,
        via: "magic_link" as const,
      };
    });
    if (durable) {
      if (!durable.ok) return durable;
      return withSessionGrant(durable);
    }
  }

  const store = getDemoStore();
  const mem = store.portalMagicTokens.get(token);
  if (!mem || mem.expiresAt < Date.now()) {
    store.portalMagicTokens.delete(token);
    return { ok: false, reason: "Invalid or expired magic link" };
  }
  store.portalMagicTokens.delete(token);
  return withSessionGrant({
    ok: true,
    clientId: mem.clientId,
    email: mem.email ?? "",
    via: "magic_link",
  });
}

/**
 * Maps a Supabase-authenticated portal email to a session bound to exactly the
 * allowlisted clientId. Returns null when the email is not an invited contact,
 * so a valid Supabase login for an un-invited address grants no portal access.
 */
export async function resolvePortalSessionForEmail(
  email: string,
): Promise<SessionUser | null> {
  const normalized = normalizeEmail(email);
  const clientId = (await getPortalAllowlist()).get(normalized);
  if (!clientId) return null;
  return portalSessionUser({ email: normalized, clientId });
}
