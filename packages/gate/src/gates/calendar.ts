import type { GateFn } from "../types";

const MS_HOUR = 60 * 60 * 1000;
export const T48_HOURS = 48;
export const T24_HOURS = 24;

export type ShootLockStatus = {
  hoursUntilShoot: number | null;
  locked: boolean;
  escalateT24: boolean;
  reason: string | null;
};

function parseShootDate(
  data: Record<string, unknown>,
): Date | null {
  const raw = data.shootDate ?? data.shoot_date;
  if (!raw) return null;
  const s = String(raw);
  // Date-only → noon UTC so T-48h windows stay stable across TZ.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? new Date(`${s}T12:00:00.000Z`)
    : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Compute T-48h / T-24h status relative to `now`. */
export function evaluateShootLock(
  data: Record<string, unknown>,
  now: Date = new Date(),
): ShootLockStatus {
  const shoot = parseShootDate(data);
  if (!shoot) {
    return {
      hoursUntilShoot: null,
      locked: false,
      escalateT24: false,
      reason: null,
    };
  }
  const hoursUntilShoot = (shoot.getTime() - now.getTime()) / MS_HOUR;
  const refApproved =
    data.refApprovalState === "approved" ||
    data.ref_approval_state === "approved";
  const locked = hoursUntilShoot <= T48_HOURS && hoursUntilShoot > 0;
  const escalateT24 =
    hoursUntilShoot <= T24_HOURS && hoursUntilShoot > 0 && !refApproved;

  let reason: string | null = null;
  if (locked) {
    reason = `T-48h shoot lock active (${hoursUntilShoot.toFixed(1)}h until shoot)`;
  }
  if (escalateT24) {
    reason = `T-24h escalate — calendar not ref-approved (${hoursUntilShoot.toFixed(1)}h until shoot)`;
  }
  return { hoursUntilShoot, locked, escalateT24, reason };
}

/**
 * Blocks shootDate / slot mutations once inside T-48h window
 * unless partner override or reschedule edge payload.
 */
export const calendarT48ShootLockGate: GateFn = async ({
  entity,
  request,
}) => {
  const mutatingShoot =
    request.to === "shoot_change" ||
    request.payload?.changeShootDate === true ||
    Boolean(request.payload?.newShootDate);

  if (!mutatingShoot) return null;

  const status = evaluateShootLock(entity.data);
  if (!status.locked) return null;

  const reschedule =
    request.payload?.rescheduleEdge === true ||
    request.overrideReason?.toLowerCase().includes("reschedule");

  if (reschedule) return null;

  return {
    gate: "calendar.t48_shoot_lock",
    reason:
      status.reason ??
      "T-48h shoot lock — late calendar/shoot changes blocked",
  };
};

export const calendarLegalTransitionGate: GateFn = async ({
  entity,
  request,
}) => {
  const allowed: Record<string, string[]> = {
    draft: ["ref_pending", "cancelled"],
    ref_pending: ["ref_approved", "cancelled"],
    ref_approved: ["shoot_locked", "cancelled"],
    shoot_locked: ["final_pending", "reschedule", "cancelled"],
    final_pending: ["final_approved", "reschedule"],
    final_approved: [],
    reschedule: ["draft", "ref_pending"],
    cancelled: ["draft"],
  };
  const next = allowed[entity.state] ?? [];
  if (!next.includes(request.to)) {
    return {
      gate: "calendar.legal_transition",
      reason: `Illegal calendar transition ${entity.state} → ${request.to}`,
    };
  }
  return null;
};
