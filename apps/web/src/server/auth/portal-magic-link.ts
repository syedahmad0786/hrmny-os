import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { and, convention, eq } from "@hrmny/db";
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

export type RequestResult = { status: "sent" };

/**
 * Enumeration-safe magic-link request. The return value is byte-identical for
 * allowlisted and unknown emails; only an allowlisted contact triggers a side
 * effect (a Supabase OTP email, or in mock mode a single-use dev token). Unknown
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

  // Mock mode (no Supabase env): deterministic single-use dev token in the store.
  if (clientId) {
    const store = getDemoStore();
    const token = `ml_${randomUUID().replace(/-/g, "")}`;
    store.portalMagicTokens.set(token, {
      token,
      clientId,
      email: normalized,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });
    store.appendAudit({
      actorEmployeeId: "00000000-0000-4000-8000-000000000000",
      action: "portal.auth.magicLink",
      entityType: "client_portal_user",
      entityId: clientId,
      before: null,
      after: { email: normalized, sent: true, via: "allowlist" },
      reason: null,
    });
    if (process.env.NODE_ENV !== "production") {
      // Dev convenience only — never returned over the wire (no enumeration).
      console.info(`[portal magic-link] dev token for ${normalized}: ${token}`);
    }
  }
  return { status: "sent" };
}

export type VerifyResult =
  | { ok: true; clientId: string; email: string; via: "magic_link" }
  | { ok: false; reason: string };

/** Mock-mode token verification: single-use and expiry-checked. */
export function verifyPortalMagicToken(token: string): VerifyResult {
  const store = getDemoStore();
  const row = store.portalMagicTokens.get(token);
  if (!row || row.expiresAt < Date.now()) {
    store.portalMagicTokens.delete(token);
    return { ok: false, reason: "Invalid or expired magic link" };
  }
  store.portalMagicTokens.delete(token); // single-use: a reused link is rejected
  store.appendAudit({
    actorEmployeeId: "00000000-0000-4000-8000-000000000000",
    action: "portal.auth.verify",
    entityType: "client_portal_user",
    entityId: row.clientId,
    before: null,
    after: { clientId: row.clientId, via: "magic_link" },
    reason: null,
  });
  return {
    ok: true,
    clientId: row.clientId,
    email: row.email ?? "",
    via: "magic_link",
  };
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
  return {
    employeeId: deterministicPortalUserId(normalized),
    email: normalized,
    displayName: normalized,
    roles: ["portal_client"],
    permissions: [...PORTAL_PERMISSIONS],
    actorType: "portal",
    clientId,
  };
}

/** Stable uuid-shaped id from an email — no client_portal_user row required. */
function deterministicPortalUserId(email: string): string {
  const h = createHash("sha256").update(`portal:${email}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
