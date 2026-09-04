import { z } from "zod";
import { ReplyIntentSchema, type ReplyIntent } from "../agent-io";
import type { LLMProvider } from "../provider";

/**
 * Golden-case eval harness. Runs against any LLMProvider; CI uses the mock
 * provider (deterministic → every case must pass, so a regression trips it).
 * Nightly can point the same cases at a live provider.
 */

export const OutreachDraftSchema = z.object({
  channel: z.enum(["email", "linkedin_connect", "linkedin_followup"]),
  subject: z.string().min(1),
  body: z.string().min(1),
  cta: z.string().min(1),
});

// Grades the mock classifier output against the frozen intent enum.
const replyIntentResultSchema = z.object({
  intent: ReplyIntentSchema,
  confidence: z.number().min(0).max(1),
});

export type EvalCheck = { name: string; passed: boolean };
export type CaseResult = { name: string; passed: boolean; checks: EvalCheck[] };
export type EvalSummary = {
  total: number;
  passed: number;
  results: CaseResult[];
};

function summarize(results: CaseResult[]): EvalSummary {
  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    results,
  };
}

// --- Outreach-draft golden cases -----------------------------------------

export type OutreachCase = {
  name: string;
  input: string;
  /** Substrings the draft body must weave in (personalization signals). */
  expectContains: string[];
};

export const OUTREACH_CASES: OutreachCase[] = [
  { name: "named-lead-acme", input: "firstName: Sara\ncompany: Acme Retail", expectContains: ["Sara", "Acme Retail"] },
  { name: "named-lead-globex", input: "firstName: Omar\ncompany: Globex", expectContains: ["Omar", "Globex"] },
  { name: "named-lead-initech", input: "firstName: Lena\ncompany: Initech", expectContains: ["Lena", "Initech"] },
  { name: "named-lead-umbrella", input: "firstName: Yusuf\ncompany: Umbrella Co", expectContains: ["Yusuf", "Umbrella Co"] },
  { name: "named-lead-hooli", input: "firstName: Priya\ncompany: Hooli", expectContains: ["Priya", "Hooli"] },
  { name: "named-lead-stark", input: "firstName: Dan\ncompany: Stark Industries", expectContains: ["Dan", "Stark Industries"] },
  { name: "named-lead-wayne", input: "firstName: Mona\ncompany: Wayne Enterprises", expectContains: ["Mona", "Wayne Enterprises"] },
  { name: "no-name-falls-back", input: "company: Nakatomi", expectContains: ["there", "Nakatomi"] },
  { name: "no-company-falls-back", input: "firstName: Aya", expectContains: ["Aya", "your team"] },
  { name: "bare-input-both-fallbacks", input: "cold lead, no fields", expectContains: ["there", "your team"] },
];

function includesAll(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.every((n) => lower.includes(n.toLowerCase()));
}

export async function runOutreachEval(
  provider: LLMProvider,
): Promise<EvalSummary> {
  const results: CaseResult[] = [];
  for (const testCase of OUTREACH_CASES) {
    const generated = await provider.generate({
      task: "outreach_draft",
      messages: [{ role: "user", content: testCase.input }],
    });
    const parsed = OutreachDraftSchema.safeParse(generated.object);
    const draft = parsed.success ? parsed.data : undefined;
    const combined = draft
      ? `${draft.subject}\n${draft.body}\n${draft.cta}`
      : "";
    const checks: EvalCheck[] = [
      { name: "valid-shape", passed: parsed.success },
      {
        name: "personalized",
        passed: !!draft && includesAll(draft.body, testCase.expectContains),
      },
      {
        name: "no-placeholder-leak",
        passed: !!draft && !/\{\{|\bundefined\b|\bnull\b/i.test(combined),
      },
      { name: "has-cta", passed: !!draft && draft.cta.trim().length > 0 },
    ];
    results.push({
      name: testCase.name,
      passed: checks.every((c) => c.passed),
      checks,
    });
  }
  return summarize(results);
}

// --- Reply-intent golden cases -------------------------------------------

export type ReplyIntentCase = {
  name: string;
  input: string;
  expected: ReplyIntent;
};

export const REPLY_INTENT_CASES: ReplyIntentCase[] = [
  { name: "keen-interested", input: "This sounds good, let's schedule a demo next week.", expected: "interested" },
  { name: "call-me-interested", input: "Interested — call me Thursday.", expected: "interested" },
  { name: "pricing-question", input: "How much does this cost for a team of 20?", expected: "question" },
  { name: "tell-me-more-question", input: "Could you tell me more about the onboarding?", expected: "question" },
  { name: "hard-no", input: "Not interested, thanks.", expected: "not_now" },
  { name: "already-have", input: "We already have a vendor for this, we'll pass.", expected: "not_now" },
  { name: "maybe-later", input: "Not right now, maybe later this year.", expected: "not_now" },
  { name: "unsubscribe", input: "Please unsubscribe me and remove me from your list.", expected: "unsubscribe" },
  { name: "ooo-other", input: "I am out of office until Monday with no email access.", expected: "other" },
  { name: "neutral-noise", input: "Received.", expected: "other" },
];

export async function runReplyIntentEval(
  provider: LLMProvider,
): Promise<EvalSummary> {
  const results: CaseResult[] = [];
  for (const testCase of REPLY_INTENT_CASES) {
    const generated = await provider.generate({
      task: "reply_intent",
      messages: [{ role: "user", content: testCase.input }],
    });
    const parsed = replyIntentResultSchema.safeParse(generated.object);
    const checks: EvalCheck[] = [
      { name: "valid-shape", passed: parsed.success },
      {
        name: "correct-intent",
        passed: parsed.success && parsed.data.intent === testCase.expected,
      },
    ];
    results.push({
      name: testCase.name,
      passed: checks.every((c) => c.passed),
      checks,
    });
  }
  return summarize(results);
}
