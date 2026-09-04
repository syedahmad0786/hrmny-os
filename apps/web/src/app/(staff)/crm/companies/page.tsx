"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import {
  CompanyCell,
  CrmBtn,
  CrmEmpty,
  CrmFilterBar,
  CrmPageHeader,
  CrmTableShell,
  CrmTag,
} from "@/components/crm/ui";
import {
  companyStatus,
  formatRelative,
  initials,
  relationshipSummary,
} from "@/components/crm/format";
import { CsvActions } from "../_components/csv-actions";
import { MergeDuplicates } from "../_components/merge-dedupe";
import { CRM_MARKETS, type CrmMarket } from "@/lib/crm-markets";

function CompaniesInner() {
  const utils = trpc.useUtils();
  const companies = trpc.crm.companies.list.useQuery();
  const deals = trpc.crm.deals.list.useQuery();
  const create = trpc.crm.companies.create.useMutation({
    onSuccess: () => void utils.crm.companies.invalidate(),
  });

  const [search, setSearch] = useState("");
  const [market, setMarket] = useState("all");
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");

  // Prefill search from omni-search deep links (/crm/companies?q=…) —
  // searchParams-driven so same-page navigations retarget the filter too.
  const deepLinkQ = useSearchParams().get("q");
  useEffect(() => {
    if (deepLinkQ !== null) setSearch(deepLinkQ);
  }, [deepLinkQ]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const dealList = deals.data ?? [];
    return (companies.data ?? [])
      .filter((c) => {
        if (market !== "all" && c.market !== market) return false;
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          (c.sector ?? "").toLowerCase().includes(q)
        );
      })
      .map((c) => {
        const linked = dealList.filter((d) => d.companyId === c.companyId);
        const open = linked.filter((d) => !d.closeOutcome);
        const won = linked.filter((d) => d.closeOutcome === "won");
        const totalValue = linked.reduce(
          (sum, d) => sum + (Number(d.quoteValue) || 0),
          0,
        );
        const status = companyStatus({
          openDeals: open.length,
          wonDeals: won.length,
        });
        return {
          ...c,
          relationship: relationshipSummary({
            openDeals: open.length,
            totalValue,
          }),
          status,
          owner: open[0]?.ownerEmployeeId ?? linked[0]?.ownerEmployeeId,
        };
      });
  }, [companies.data, deals.data, search, market]);

  return (
    <main>
      <CrmPageHeader
        title="Companies"
        description="One account record from first prospecting touch through active client."
        actions={
          <>
            <CsvActions kind="companies" />
            <CrmBtn
              variant="primary"
              disabled={create.isPending || !name.trim()}
              onClick={() =>
                void create
                  .mutateAsync({
                    name: name.trim(),
                    sector: sector.trim() || null,
                    market: market === "all" ? "UAE" : (market as CrmMarket),
                  })
                  .then(() => {
                    setName("");
                    setSector("");
                  })
              }
            >
              ＋ Add company
            </CrmBtn>
          </>
        }
      />

      <CrmFilterBar>
        <input
          placeholder="Search companies"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          placeholder="New company name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          placeholder="Sector"
          value={sector}
          onChange={(e) => setSector(e.target.value)}
        />
        <select value={market} onChange={(e) => setMarket(e.target.value)}>
          <option value="all">All markets</option>
          {CRM_MARKETS.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </CrmFilterBar>

      <MergeDuplicates kind="companies" />

      {companies.isLoading ? (
        <CrmEmpty title="Loading companies…" />
      ) : rows.length === 0 ? (
        <CrmEmpty
          title="No companies yet"
          hint="Add a company to anchor contacts and deals."
        />
      ) : (
        <CrmTableShell
          foot={`${rows.length} company records · CRM and active clients`}
        >
          <table className="crm-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Sector</th>
                <th>Market</th>
                <th>Website</th>
                <th>Relationship</th>
                <th>Owner</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.companyId}>
                  <td>
                    <CompanyCell
                      name={c.name}
                      subtitle={`Updated ${formatRelative(c.updatedAt)}`}
                      mark={initials(c.name)}
                    />
                  </td>
                  <td>{c.sector ?? "—"}</td>
                  <td>{c.market ?? "—"}</td>
                  <td>
                    {c.website ? (
                      <a
                        href={c.website}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--ochre-dark)]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Site
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{c.relationship}</td>
                  <td>
                    <span className="crm-initials">
                      {initials(c.owner ? "AM" : "CH")}
                    </span>
                  </td>
                  <td>
                    <CrmTag kind={c.status.kind}>{c.status.label}</CrmTag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CrmTableShell>
      )}
    </main>
  );
}

export default function CrmCompaniesPage() {
  // useSearchParams requires a Suspense boundary (portal/login/verify precedent).
  return (
    <Suspense>
      <CompaniesInner />
    </Suspense>
  );
}
