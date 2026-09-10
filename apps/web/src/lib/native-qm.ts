export const NATIVE_QM_URL = "https://hrmny-portal.fly.dev";
export const NATIVE_QM_ADMIN_URL = `${NATIVE_QM_URL}/admin/`;

export function canOpenNativeQm(session: {
  actorType?: string | null;
  employeeId?: string | null;
  workspacePreview?: unknown;
} | null | undefined) {
  return (
    session?.actorType === "staff" &&
    Boolean(session.employeeId) &&
    !session.workspacePreview
  );
}
