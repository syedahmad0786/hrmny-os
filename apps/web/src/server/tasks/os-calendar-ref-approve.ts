/**
 * Shared OS calendar ref-approve (→ ref_approved).
 * Mirrors staff `calendars.refApprove` for agent `calendar.os_ref_approve`.
 */
import { getDemoStore, type DemoCalendar } from "../demo-store";
import { getDb } from "../db";
import { updateDeliveryCalendar } from "./delivery-calendars";

export type OsCalendarRefApproveResult = {
  ok: boolean;
  reason?: string;
  calendar: DemoCalendar | null;
};

export async function refApproveOsCalendar(input: {
  calendarId: string;
  actorEmployeeId?: string | null;
}): Promise<OsCalendarRefApproveResult> {
  if (getDb()) {
    const durable = await updateDeliveryCalendar({
      calendarId: input.calendarId,
      refApprovalState: "approved",
      state: "ref_approved",
    });
    if (durable) {
      return { ok: true, calendar: durable };
    }
    return { ok: false, reason: "NOT_FOUND", calendar: null };
  }

  const store = getDemoStore();
  const cal = store.calendars.get(input.calendarId);
  if (!cal) {
    return { ok: false, reason: "NOT_FOUND", calendar: null };
  }
  cal.refApprovalState = "approved";
  cal.state = "ref_approved";
  store.appendAudit({
    actorEmployeeId:
      input.actorEmployeeId ?? "c0000000-0000-4000-8000-000000000001",
    action: "calendars.refApprove",
    entityType: "calendar",
    entityId: cal.calendarId,
    before: null,
    after: { refApprovalState: "approved", via: "calendar.os_ref_approve" },
    reason: null,
  });
  return { ok: true, calendar: cal };
}

export function parseCalendarIdFromPrompt(prompt: string): string | null {
  const labeled = prompt.match(
    /calendar(?:Id)?\s*[:=]\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  if (labeled?.[1]) return labeled[1].toLowerCase();
  return null;
}
