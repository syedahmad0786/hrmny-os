import type { ApprovalProposal } from "./mock-data";

// ponytail: naive set-based line diff (no LCS) — a line is "added" if the draft
// has it and the baseline doesn't, "removed" the other way. Good enough for a
// short outreach preview; swap for a real diff if multi-line reorders matter.
export function lineDiff(baseline: string, draft: string) {
  const before = baseline.split("\n");
  const after = draft.split("\n");
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return [
    ...before
      .filter((line) => !afterSet.has(line))
      .map((line) => ({ sign: "-" as const, line })),
    ...after.map((line) => ({
      sign: (beforeSet.has(line) ? " " : "+") as "+" | " ",
      line,
    })),
  ];
}

export function DraftPreview({ proposal }: { proposal: ApprovalProposal }) {
  if (!proposal.baseline) {
    return (
      <pre className="whitespace-pre-wrap rounded-lg border border-sand bg-white/70 p-4 font-body text-sm text-ink">
        {proposal.draft}
      </pre>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-sand bg-white/70 font-mono text-xs">
      {lineDiff(proposal.baseline, proposal.draft).map((row, index) => (
        <div
          key={index}
          className={
            row.sign === "+"
              ? "flex gap-2 bg-emerald-50 px-3 py-0.5 text-emerald-900"
              : row.sign === "-"
                ? "flex gap-2 bg-red-50 px-3 py-0.5 text-red-800 line-through decoration-red-300"
                : "flex gap-2 px-3 py-0.5 text-muted"
          }
        >
          <span aria-hidden className="select-none opacity-60">
            {row.sign}
          </span>
          <span className="whitespace-pre-wrap">{row.line || " "}</span>
        </div>
      ))}
    </div>
  );
}
