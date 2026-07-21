import { Providers } from "@/components/providers";
import { PortalShell } from "@/components/portal-shell";

/**
 * Portal route group — separate shell from staff.
 * Do not import finance / margin / payroll components into this tree.
 */
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <PortalShell>{children}</PortalShell>
    </Providers>
  );
}
