import { CrmRecordDetail } from "@/components/crm/record-detail";
// Static shell for the existing acceptance fixture; live records remain dynamic and authorized at the API.
export function generateStaticParams() {
  return [{ id: "11000000-0000-4000-8000-000000000001" }];
}
export const dynamicParams = true;
export default function CompanyPage() {
  return <CrmRecordDetail kind="companies" />;
}
