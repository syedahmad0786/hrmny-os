"use client";

import { ConnectionsPageContent } from "@/app/(staff)/settings/connections/connections-page-content";
import { Providers } from "@/components/providers";
import { trpc } from "@/lib/trpc";

function StaffIntegrations() {
  const session = trpc.auth.session.useQuery();

  if (session.isLoading)
    return <main className="p-6 text-sm text-muted">Checking access…</main>;
  if (!session.data?.employeeId || session.data.actorType !== "staff")
    return (
      <main className="p-6 text-sm text-muted">
        Sign in to hrmny OS with an active staff account to manage integrations.
      </main>
    );
  return <ConnectionsPageContent embedded />;
}

/**
 * Native chat opens this fixed route in a contained frame. Account operations
 * remain the existing owned-account Connections UI after staff auth resolves.
 */
export default function AssistantIntegrationsPage() {
  return (
    <Providers>
      <StaffIntegrations />
    </Providers>
  );
}
