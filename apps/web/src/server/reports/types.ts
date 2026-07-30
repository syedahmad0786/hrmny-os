/**
 * Report artifact shape + markdown render + due-schedule math. A report is
 * assembled into a `ReportArtifact` ({title, sections, generatedAt}) that any
 * report can render to markdown identically; the scheduler stores that markdown
 * on the report_run and the Resend adapter emails it.
 */

export type ReportKey =
  | "weekly-agency"
  | "pipeline-summary"
  | "capacity-forecast"
  | "campaign-summary";

export type ReportSection = { heading: string; lines: string[] };

export type ReportArtifact = {
  title: string;
  sections: ReportSection[];
  /** ISO timestamp the artifact was assembled. */
  generatedAt: string;
};

/** Deterministic markdown render — same for every report so delivery is uniform. */
export function renderMarkdown(artifact: ReportArtifact): string {
  const header = `# ${artifact.title}\n\n_Generated ${artifact.generatedAt}_`;
  const body = artifact.sections
    .map((section) => {
      const lines = section.lines.length
        ? section.lines.map((line) => `- ${line}`).join("\n")
        : "_No data_";
      return `## ${section.heading}\n\n${lines}`;
    })
    .join("\n\n");
  return `${header}\n\n${body}\n`;
}

// ── Cadence / due math ───────────────────────────────────────

export type Cadence = "daily" | "weekly" | "monthly";

const CADENCE_MS: Record<Cadence, number> = {
  daily: 86_400_000,
  weekly: 7 * 86_400_000,
  monthly: 30 * 86_400_000,
};

export const CADENCES = Object.keys(CADENCE_MS) as Cadence[];

export type DueCheck = {
  enabled: boolean;
  cadence: string;
  lastRunAt: string | null;
};

/**
 * A schedule is due when enabled and it has never run, or at least its cadence
 * interval has elapsed since the last run.
 *
 * ponytail: interval-since-last-run, not wall-clock cron — a `weekly` report
 * fires ~7d after its last run, not every Monday 09:00. Swap CADENCE_MS for a
 * cron parser only if a schedule must land at a specific local time. An unknown
 * cadence keyword never auto-fires (fail safe, not fail open).
 */
export function isDue(schedule: DueCheck, now: Date): boolean {
  if (!schedule.enabled) return false;
  const interval = CADENCE_MS[schedule.cadence as Cadence];
  if (!interval) return false;
  if (!schedule.lastRunAt) return true;
  return now.getTime() - new Date(schedule.lastRunAt).getTime() >= interval;
}
