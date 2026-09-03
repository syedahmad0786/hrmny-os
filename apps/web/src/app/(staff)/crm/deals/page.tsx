"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { isSyntheticRecordName } from "@/lib/synthetic-records";
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
  formatContactName,
  formatAed,
  formatLane,
  formatRelative,
  initials,
  workEmailState,
} from "@/components/crm/format";

export default function CrmDealsPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const deals = trpc.crm.deals.list.useQuery();
  const contacts = trpc.crm.contacts.list.useQuery();
  const stages = trpc.crm.stages.useQuery();
  const digest = trpc.salesOs.digest.useQuery();
  const create = trpc.crm.deals.create.useMutation({
    onSuccess: () => void utils.crm.deals.invalidate(),
  });
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const [name, setName] = useState("");
  const [showTestRecords, setShowTestRecords] = useState(false);
  const contactById = useMemo(
    () =>
      new Map(
        (contacts.data ?? []).map((contact) => [contact.contactId, contact]),
      ),
    [contacts.data],
  );

  const stallByDeal = useMemo(() => {
    const m = new Map<string, { daysInStage: number; maxDays: number }>();
    for (const s of digest.data?.stalled ?? []) {
      m.set(s.dealId, { daysInStage: s.daysInStage, maxDays: s.maxDays });
    }
    return m;
  }, [digest.data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (deals.data ?? []).filter((d) => {
      if (!showTestRecords && isSyntheticRecordName(d.companyName)) {
        return false;
      }
      if (stage !== "all" && d.stage !== stage) return false;
      if (!q) return true;
      const leadName = formatContactName(
        d.primaryContactId ? contactById.get(d.primaryContactId) : null,
      );
      return (
        d.companyName.toLowerCase().includes(q) ||
        (leadName ?? "").toLowerCase().includes(q) ||
        (d.sector ?? "").toLowerCase().includes(q)
      );
    });
  }, [contactById, deals.data, search, showTestRecords, stage]);
  const hiddenTestCount = (deals.data ?? []).filter((deal) =>
    isSyntheticRecordName(deal.companyName),
  ).length;
  const visibleStalled = (digest.data?.stalled ?? []).filter(
    (deal) => showTestRecords || !isSyntheticRecordName(deal.companyName),
  );

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
              void create
                .mutateAsync({
                  companyName: name.trim() || "New prospect",
                  leadSourceLane: "relationship_led",
                })
                .then(() => setName(""))
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
        <select value={stage} onChange={(e) => setStage(e.target.value)}>
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

      {hiddenTestCount ? (
        <label className="mb-3 flex min-h-11 w-fit items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            className="size-5"
            checked={showTestRecords}
            onChange={(event) => setShowTestRecords(event.target.checked)}
          />
          {showTestRecords ? "Hide" : "Show"} {hiddenTestCount} test deal
          {hiddenTestCount === 1 ? "" : "s"}
        </label>
      ) : null}

      {digest.data ? (
        <section
          className="crm-panel mb-4"
          data-testid="sales-os-pipeline-review"
        >
          <div className="crm-panel-head">
            <div>
              <h3>Pipeline review</h3>
              <p>
                Coverage {digest.data.coverage.coverageX.toFixed(1)}× vs{" "}
                {digest.data.coverage.targetX}× H1 · {visibleStalled.length}{" "}
                stalled
              </p>
            </div>
            <CrmTag kind={digest.data.coverage.healthy ? "success" : "warn"}>
              {digest.data.coverage.healthy ? "Healthy" : "Thin coverage"}
            </CrmTag>
          </div>
          {visibleStalled.length > 0 ? (
            <div className="crm-panel-body">
              <ul className="text-sm space-y-1">
                {visibleStalled.slice(0, 8).map((s) => (
                  <li key={s.dealId}>
                    <Link className="underline" href={`/crm/deals/${s.dealId}`}>
                      {s.companyName}
                    </Link>{" "}
                    · {s.daysInStage}d in {s.stage.replace(/_/g, " ")} (max{" "}
                    {s.maxDays})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {deals.isLoading ? (
        <CrmEmpty title="Loading deals…" />
      ) : rows.length === 0 ? (
        <CrmEmpty
          title="No deals yet"
          hint="Create a deal to start the pipeline rhythm."
        />
      ) : (
        <CrmTableShell foot={`${rows.length} deals · live CRM`}>
          <table className="crm-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Stage</th>
                <th>BUAF</th>
                <th>Lane</th>
                <th>Value</th>
                <th>Email</th>
                <th>Owner</th>
                <th>Stall</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const buaf = buafScore(d);
                const contact = d.primaryContactId
                  ? contactById.get(d.primaryContactId)
                  : undefined;
                const leadName = formatContactName(contact);
                const email = workEmailState(contact, d.emailVerified);
                const stageLabel =
                  stages.data?.find((item) => item.key === d.stage)?.label ??
                  String(d.stage).replace(/_/g, " ");
                return (
                  <tr
                    key={d.dealId}
                    onClick={() => router.push(`/crm/deals/${d.dealId}`)}
                  >
                    <td>
                      <CompanyCell
                        name={leadName ?? "Lead name unavailable"}
                        subtitle={d.companyName}
                        mark={initials(leadName ?? d.companyName)}
                      />
                    </td>
                    <td>
                      <CrmTag kind="info">{stageLabel}</CrmTag>
                    </td>
                    <td>{buaf.label}</td>
                    <td>{formatLane(d.leadSourceLane)}</td>
                    <td>
                      <strong>{formatAed(d.quoteValue)}</strong>
                    </td>
                    <td>
                      <CrmTag kind={email.kind}>{email.label}</CrmTag>
                    </td>
                    <td>
                      <span className="crm-initials">
                        {initials(d.ownerEmployeeId ? "AM" : "CH")}
                      </span>
                    </td>
                    <td>
                      {stallByDeal.has(d.dealId) ? (
                        <CrmTag kind="danger">
                          {stallByDeal.get(d.dealId)!.daysInStage}d /{" "}
                          {stallByDeal.get(d.dealId)!.maxDays}
                        </CrmTag>
                      ) : (
                        <CrmTag kind="success">ok</CrmTag>
                      )}
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
