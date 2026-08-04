"use client";

import { useEffect, useMemo, useState } from "react";
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
import { formatRelative, initials } from "@/components/crm/format";
import { CsvActions } from "../_components/csv-actions";
import { MergeDuplicates } from "../_components/merge-dedupe";

export default function CrmContactsPage() {
  const utils = trpc.useUtils();
  const contacts = trpc.crm.contacts.list.useQuery();
  const companies = trpc.crm.companies.list.useQuery();
  const deals = trpc.crm.deals.list.useQuery();
  const activities = trpc.crm.activities.list.useQuery({ limit: 100 });
  const create = trpc.crm.contacts.create.useMutation({
    onSuccess: () => void utils.crm.contacts.invalidate(),
  });

  const [search, setSearch] = useState("");
  const [companyId, setCompanyId] = useState("all");
  const [verify, setVerify] = useState("all");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");

  // Prefill search from omni-search deep links (/crm/contacts?q=…).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setSearch(q);
  }, []);

  const companyMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of companies.data ?? []) m.set(c.companyId, c.name);
    return m;
  }, [companies.data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const acts = activities.data ?? [];
    const dealList = deals.data ?? [];
    return (contacts.data ?? [])
      .filter((c) => {
        if (companyId !== "all" && c.companyId !== companyId) return false;
        if (verify === "verified" && !c.emailVerified) return false;
        if (verify === "unverified" && c.emailVerified) return false;
        if (!q) return true;
        const name = `${c.firstName} ${c.lastName ?? ""}`.toLowerCase();
        return (
          name.includes(q) ||
          (c.email ?? "").toLowerCase().includes(q) ||
          (c.title ?? "").toLowerCase().includes(q)
        );
      })
      .map((c) => {
        const lastAct = acts
          .filter((a) => a.contactId === c.contactId)
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
        const dealCount = dealList.filter(
          (d) =>
            d.primaryContactId === c.contactId ||
            (c.companyId && d.companyId === c.companyId),
        ).length;
        return {
          ...c,
          companyName: c.companyId
            ? (companyMap.get(c.companyId) ?? "—")
            : "—",
          lastTouch: lastAct?.occurredAt ?? c.updatedAt,
          dealCount,
        };
      });
  }, [
    contacts.data,
    search,
    companyId,
    verify,
    companyMap,
    activities.data,
    deals.data,
  ]);

  const verifiedPct = useMemo(() => {
    const all = contacts.data ?? [];
    if (all.length === 0) return 0;
    return Math.round(
      (all.filter((c) => c.emailVerified).length / all.length) * 100,
    );
  }, [contacts.data]);

  return (
    <main>
      <CrmPageHeader
        title="Contacts"
        description="Verified people, linked to companies, deals and activity."
        actions={
          <>
          <CsvActions kind="contacts" />
          <CrmBtn
            variant="primary"
            disabled={create.isPending || !firstName.trim()}
            onClick={() =>
              void create
                .mutateAsync({
                  firstName: firstName.trim(),
                  email: email.trim() || null,
                  companyId: companyId === "all" ? null : companyId,
                })
                .then(() => {
                  setFirstName("");
                  setEmail("");
                })
            }
          >
            ＋ Add contact
          </CrmBtn>
          </>
        }
      />

      <CrmFilterBar>
        <input
          placeholder="Search people or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          placeholder="First name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="all">All companies</option>
          {(companies.data ?? []).map((c) => (
            <option key={c.companyId} value={c.companyId}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={verify} onChange={(e) => setVerify(e.target.value)}>
          <option value="all">Verification: any</option>
          <option value="verified">Verified</option>
          <option value="unverified">Unverified</option>
        </select>
      </CrmFilterBar>

      <MergeDuplicates kind="contacts" />

      {contacts.isLoading ? (
        <CrmEmpty title="Loading contacts…" />
      ) : rows.length === 0 ? (
        <CrmEmpty title="No contacts yet" hint="Add people linked to companies and deals." />
      ) : (
        <CrmTableShell
          foot={`${rows.length} people · ${verifiedPct}% verified email coverage`}
        >
          <table className="crm-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Company</th>
                <th>Title</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Enrichment</th>
                <th>Deals</th>
                <th>Last touch</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const full = `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`;
                return (
                  <tr key={c.contactId}>
                    <td>
                      <CompanyCell
                        name={full}
                        subtitle={c.isPrimary ? "Primary" : undefined}
                        mark={initials(full)}
                      />
                    </td>
                    <td>{c.companyName}</td>
                    <td>{c.title ?? "—"}</td>
                    <td>{c.email ?? "—"}</td>
                    <td>{c.phone ?? "—"}</td>
                    <td>
                      <CrmTag kind={c.emailVerified ? "success" : "warn"}>
                        {c.emailVerified ? "Verified" : "Unverified"}
                      </CrmTag>
                    </td>
                    <td>{c.dealCount}</td>
                    <td>{formatRelative(c.lastTouch)}</td>
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
