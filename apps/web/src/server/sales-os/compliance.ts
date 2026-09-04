import { createHmac, timingSafeEqual } from "node:crypto";
import { listOutreach } from "../leadgen/store";
import {
  addSuppression,
  creditUsed,
  getSalesOsSettings,
  isSuppressed,
  listEmailEvents,
} from "./store";
import type { SuppressionReason } from "./types";

export const FOOTER_MARKER = "— hrmny outreach —";
const UNSUBSCRIBE_TTL_SECONDS = 180 * 24 * 60 * 60;

function unsubscribeSecret(): string {
  const secret = process.env.SALES_UNSUBSCRIBE_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SALES_UNSUBSCRIBE_SECRET is required");
  }
  return "hrmny-local-unsubscribe-only";
}

function validEmail(email: string): boolean {
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function createUnsubscribeToken(
  emailInput: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const email = emailInput.trim().toLowerCase();
  if (!validEmail(email)) throw new Error("Valid unsubscribe email required");
  const encodedEmail = Buffer.from(email, "utf8").toString("base64url");
  const expiresAt = nowSeconds + UNSUBSCRIBE_TTL_SECONDS;
  const payload = `${encodedEmail}.${expiresAt}`;
  const signature = createHmac("sha256", unsubscribeSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyUnsubscribeToken(
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string | null {
  const [encodedEmail, expiryText, signature, extra] = token.split(".");
  if (!encodedEmail || !expiryText || !signature || extra) return null;
  const expiresAt = Number(expiryText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < nowSeconds) return null;
  const expected = createHmac("sha256", unsubscribeSecret())
    .update(`${encodedEmail}.${expiryText}`)
    .digest("base64url");
  const receivedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    receivedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(receivedBytes, expectedBytes)
  ) {
    return null;
  }
  try {
    const email = Buffer.from(encodedEmail, "base64url")
      .toString("utf8")
      .trim()
      .toLowerCase();
    return validEmail(email) ? email : null;
  } catch {
    return null;
  }
}

export function buildUnsubscribeUrl(path: string, email: string): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    (process.env.NODE_ENV === "production"
      ? "https://hrmny-os.vercel.app"
      : "http://localhost:3000");
  const origin = new URL(
    /^https?:\/\//i.test(configured) ? configured : `https://${configured}`,
  ).origin;
  const url = new URL(path, `${origin}/`);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Unsubscribe URL must use HTTP or HTTPS");
  }
  url.searchParams.set("token", createUnsubscribeToken(email));
  return url.toString();
}

export function hasValidUnsubscribeLink(body: string, email: string): boolean {
  const link = body.match(
    /(?:Unsubscribe:|To stop hearing from us:)\s+(https?:\/\/\S+)/i,
  )?.[1];
  if (!link) return false;
  try {
    const url = new URL(link);
    const token = url.searchParams.get("token");
    return (
      token !== null &&
      url.origin === new URL(buildUnsubscribeUrl("/", email)).origin &&
      verifyUnsubscribeToken(token) === email.trim().toLowerCase()
    );
  } catch {
    return false;
  }
}

export function domainOf(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  return email.split("@")[1]!.toLowerCase();
}

export function buildComplianceFooter(input?: {
  senderName?: string;
  senderTitle?: string;
  physicalAddress?: string;
  unsubscribeUrl?: string;
}): string {
  const name = input?.senderName ?? "Ayham Homsi";
  const title = input?.senderTitle ?? "Managing Partner, hrmny";
  const address =
    input?.physicalAddress ?? "hrmny, Dubai, United Arab Emirates";
  const unsub = input?.unsubscribeUrl ?? "/api/sales-os/unsubscribe";
  return [
    "",
    FOOTER_MARKER,
    name,
    title,
    address,
    `To stop hearing from us: ${unsub}`,
  ].join("\n");
}

export function ensureFooter(body: string, footer?: string): string {
  if (body.includes(FOOTER_MARKER)) {
    if (!footer) return body;
    return `${body.split(FOOTER_MARKER)[0]!.trimEnd()}\n${footer}`;
  }
  return `${body.trimEnd()}\n${footer ?? buildComplianceFooter()}`;
}

export async function suppressTarget(input: {
  email?: string | null;
  domain?: string | null;
  reason: SuppressionReason;
  source?: string | null;
}) {
  const existing = await isSuppressed(input);
  if (existing) return existing;
  return addSuppression(input);
}

export type SendBlock =
  { ok: true } | { ok: false; code: string; reason: string };

export function outreachVoiceViolations(
  body: string,
  companyName?: string | null,
): string[] {
  const copy = body.split(FOOTER_MARKER)[0]!.trim();
  const violations: string[] = [];
  if (copy.length < 40)
    violations.push("Message is too short to review safely");
  if (/guaranteed results/i.test(copy)) {
    violations.push("Remove the guaranteed-results claim");
  }
  if (/\b(?:our )?proven track record\b/i.test(copy)) {
    violations.push("Remove the unsupported proven-track-record claim");
  }
  if (
    companyName?.trim() &&
    !copy.toLowerCase().includes(companyName.trim().toLowerCase())
  ) {
    violations.push(`Mention ${companyName.trim()} specifically`);
  }
  return violations;
}

export async function assertEmailSendAllowed(input: {
  email?: string | null;
  emailVerified?: boolean;
  body?: string;
  companyName?: string | null;
  mailbox?: string | null;
  now?: Date;
}): Promise<SendBlock> {
  const settings = await getSalesOsSettings();
  if (settings.caps.pauseAllOutreach) {
    return {
      ok: false,
      code: "OUTREACH_PAUSED",
      reason: "Global outreach kill switch is on",
    };
  }
  if (input.emailVerified === false) {
    return {
      ok: false,
      code: "EMAIL_UNVERIFIED",
      reason: "Email must be verified by the connected provider before send",
    };
  }
  if (input.body) {
    const violations = outreachVoiceViolations(input.body, input.companyName);
    if (violations.length) {
      return {
        ok: false,
        code: "VOICE_CHECK_FAILED",
        reason: `Voice check failed: ${violations.join("; ")}`,
      };
    }
  }
  const hit = await isSuppressed({
    email: input.email,
    domain: domainOf(input.email),
  });
  if (hit) {
    return {
      ok: false,
      code: "SUPPRESSED",
      reason: `Suppressed (${hit.reason})`,
    };
  }
  const now = input.now ?? new Date();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const sentToday = (
    await listEmailEvents({ kind: "sent", sinceIso: dayStart.toISOString() })
  ).length;
  const outreachSent = (await listOutreach({ state: "sent" })).filter((o) => {
    if (!isEmailChannel(o.channel) || !o.sentAt) return false;
    return o.sentAt >= dayStart.toISOString();
  }).length;
  const used = Math.max(sentToday, outreachSent);
  if (used >= settings.caps.emailPerDay) {
    return {
      ok: false,
      code: "DAILY_CAP",
      reason: `Daily email cap ${settings.caps.emailPerDay} reached`,
    };
  }
  return { ok: true };
}

export async function assertLinkedInAssistAllowed(
  now = new Date(),
): Promise<SendBlock> {
  const settings = await getSalesOsSettings();
  if (settings.caps.pauseAllOutreach) {
    return {
      ok: false,
      code: "OUTREACH_PAUSED",
      reason: "Global outreach kill switch is on",
    };
  }
  const week = weekKey(now);
  const used = await creditUsed("linkedin_assist", week);
  if (used >= settings.caps.linkedinConnectsPerWeek) {
    return {
      ok: false,
      code: "WEEKLY_CAP",
      reason: `Weekly LinkedIn assist cap ${settings.caps.linkedinConnectsPerWeek} reached`,
    };
  }
  return { ok: true };
}

export function isEmailChannel(channel: string): boolean {
  return channel === "gmail" || channel === "email";
}

export function isLinkedInChannel(channel: string): boolean {
  return channel === "linkedin" || channel.startsWith("linkedin_");
}

export function weekKey(date: Date = new Date()): string {
  const tmp = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
