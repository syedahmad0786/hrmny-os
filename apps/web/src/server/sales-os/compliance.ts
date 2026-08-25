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
  const address = input?.physicalAddress ?? "hrmny, Dubai, United Arab Emirates";
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
  if (body.includes(FOOTER_MARKER)) return body;
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
  | { ok: true }
  | { ok: false; code: string; reason: string };

export async function assertEmailSendAllowed(input: {
  email?: string | null;
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
  const sentToday = (await listEmailEvents({ kind: "sent", sinceIso: dayStart.toISOString() }))
    .length;
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

export async function assertLinkedInAssistAllowed(now = new Date()): Promise<SendBlock> {
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
  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
