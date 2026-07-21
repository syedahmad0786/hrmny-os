import { redirect } from "next/navigation";

export default async function SalesDealRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/crm/deals/${id}`);
}
