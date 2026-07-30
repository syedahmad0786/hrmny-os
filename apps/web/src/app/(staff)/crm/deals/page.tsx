"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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
  buafScore,
  formatAed,
  formatLane,
  formatRelative,
  initials,
} from "@/components/crm/format";

export default function CrmDealsPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const deals = trpc.crm.deals.list.useQuery();
  const stages = trpc.crm.stages.useQuery();
  const create = trpc.crm.deals.create.useMutation({
    onSuccess: () => void utils.crm.deals.invalidate(),
  });
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const [name, setName] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (deals.data ?? []).filter((d) => {
      if (stage !== "all" && d.stage !== stage) return false;
      if (!q) return true;
      return (
        d.companyName.toLowerCase().includes(q) ||
        (d.sector ?? "").toLowerCase().includes(q)
      );
    });
  }, [deals.data, search, stage]);

  return (
    <main>
      <CrmPageHeader
        title="Deals"
        description="A sortable commercial view of every active opportunity."
        actions={
          <CrmBtn
            variant="primary"
            disabled={create.isPending}
            onClick={() =>
              void create.mutateAsync({
                companyName: name.trim() || "New prospect",
                leadSourceLane: "relationship_led",
              }).then(() => setName(""))
            }
          >
            ＋ Create deal
          </CrmBtn>
        }
      />

      <CrmFilterBar>
        <input
          placeholder="Search deals"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          placeholder="New company"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          aria-label="Filter by stage"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
        >
          <option value="all">All stages</option>
          {(stages.data ?? []).map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="crm-view-switch">
          <Link href="/crm">Board</Link>
          <Link href="/crm/deals" className="active">
            List
          </Link>
        </div>
      </CrmFilterBar>

      {deals.isLoading ? (
        <CrmEmpty title="Loading deals…" />
      ) : rows.length === 0 ? (
        <CrmEmpty title="No deals yet" hint="Create a deal to start the pipeline rhythm." />
      ) : (
        <CrmTableShell foot={`${rows.length} deals · live CRM`}>
          <table className="crm-table">
            <thead>
              <tr>
                <th>Deal</th>
                <th>Stage</th>
                <th>BUAF</th>
                <th>Lane</th>
                <th>Value</th>
                <th>Email</th>
                <th>Owner</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const buaf = buafScore(d);
                return (
                  <tr
                    key={d.dealId}
                    onClick={() => router.push(`/crm/deals/${d.dealId}`)}
                  >
                    <td>
                      <CompanyCell
                        name={d.sector ?? "Opportunity"}
                        subtitle={d.companyName}
                        mark={initials(d.companyName)}
                      />
                    </td>
                    <td>
                      <CrmTag kind="info">{String(d.stage).replace(/_/g, " ")}</CrmTag>
                    </td>
                    <td>{buaf.label}</td>
                    <td>{formatLane(d.leadSourceLane)}</td>
                    <td>
                      <strong>{formatAed(d.quoteValue)}</strong>
                    </td>
                    <td>
                      <CrmTag kind={d.emailVerified ? "success" : "warn"}>
                        {d.emailVerified ? "Verified" : "Unverified"}
                      </CrmTag>
                    </td>
                    <td>
                      <span className="crm-initials">
                        {initials(d.ownerEmployeeId ? "AM" : "CH")}
                      </span>
                    </td>
                    <td>Updated {formatRelative(d.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CrmTableShell>
      )}
    </main>
  );
}
