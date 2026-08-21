import { sql } from "@hrmny/db";
import { getDb } from "../db";
import { sendPortalInviteMagicLink } from "./portal-magic-link";

/**
 * Magic-link href for staff "open portal review" CTAs after creative/Canva attach.
 * Prefer an existing portal user email for the client; otherwise mint a
 * placeholder @example.com invite (Resend mock) so demo closed-loop works.
 * Falls back to /portal/login only when invite cannot be issued.
 */
export async function portalReviewHref(clientId: string): Promise<string> {
  const id = clientId.trim();
  if (!id) return "/portal/login";

  let email = `portal+${id.slice(0, 8)}@example.com`;
  let displayName = "Portal guest";
  const db = getDb();
  if (db) {
    try {
      const rows = await db.execute<{
        email: string;
        displayName: string | null;
      }>(sql`
        select email, display_name as "displayName"
        from public.client_portal_user
        where client_id = ${id}::uuid
          and is_active = true
        order by updated_at desc nulls last
        limit 1
      `);
      const row = rows[0];
      if (row?.email?.trim()) {
        email = row.email.trim().toLowerCase();
        displayName = row.displayName?.trim() || email;
      }
    } catch {
      /* memory / missing table — use placeholder */
    }
  }

  try {
    const placeholder = email.endsWith("@example.com");
    const { createResendMock } = await import("@hrmny/integrations");
    const sent = await sendPortalInviteMagicLink({
      clientId: id,
      email,
      displayName,
      emailer: placeholder ? createResendMock() : undefined,
    });
    return sent.portalPath;
  } catch {
    return "/portal/login";
  }
}
