import { Providers } from "@/components/providers";
import { StaffShell } from "@/components/staff-shell";

export default function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <StaffShell>{children}</StaffShell>
    </Providers>
  );
}
