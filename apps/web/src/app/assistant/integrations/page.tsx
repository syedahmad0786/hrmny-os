"use client";

import { Providers } from "@/components/providers";
import { ConnectionsPageContent } from "@/app/(staff)/settings/connections/page";

/**
 * Native chat opens this fixed, staff-authenticated page in a contained frame.
 * The connection operations remain the existing owned-account Connections UI.
 */
export default function AssistantIntegrationsPage() {
  return (
    <Providers>
      <ConnectionsPageContent embedded />
    </Providers>
  );
}
