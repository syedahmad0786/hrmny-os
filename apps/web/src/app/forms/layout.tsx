import { Providers } from "@/components/providers";

export default function PublicFormsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Providers>{children}</Providers>;
}
