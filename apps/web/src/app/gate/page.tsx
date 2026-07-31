import { notFound } from "next/navigation";
import { Providers } from "@/components/providers";
import { StaffShell } from "@/components/staff-shell";
import GateDemoPage from "@/app/(staff)/gate/gate-demo";
import { getAuthMode } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default function GatePage() {
  if (getAuthMode() !== "dev") notFound();
  return (
    <Providers>
      <StaffShell>
        <GateDemoPage />
      </StaffShell>
    </Providers>
  );
}
