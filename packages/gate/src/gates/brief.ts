/** Form 2 Definition of Ready — required brief fields. */
export const DOR_REQUIRED_FIELDS = [
  "objective",
  "audience",
  "deliverables",
  "deadline",
  "brandAssets",
  "channels",
  "successMetric",
] as const;

export type DorField = (typeof DOR_REQUIRED_FIELDS)[number];

export type DorValidation = {
  missing: DorField[];
  missingRequiredCount: number;
  dorComplete: boolean;
  canLock: boolean;
};

function fieldPresent(body: Record<string, unknown>, key: DorField): boolean {
  const v = body[key] ?? body[key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)];
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return Boolean(v);
}

/** Validate Form 2 DoR. Lock allowed only when missing ≤ 2. */
export function validateDor(body: Record<string, unknown>): DorValidation {
  const missing = DOR_REQUIRED_FIELDS.filter((k) => !fieldPresent(body, k));
  const missingRequiredCount = missing.length;
  const canLock = missingRequiredCount <= 2;
  return {
    missing,
    missingRequiredCount,
    dorComplete: missingRequiredCount === 0,
    canLock,
  };
}

export function dorLockBlockedReason(validation: DorValidation): string | null {
  if (validation.canLock) return null;
  return `DoR lock blocked — ${validation.missingRequiredCount} required items missing (max 2). Missing: ${validation.missing.join(", ")}`;
}
