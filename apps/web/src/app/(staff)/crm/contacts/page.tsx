"use client";

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
import { formatRelative, initials } from "@/components/crm/format";
import { usePageTitle } from "@/components/use-page-title";

export default function CrmContactsPage() {
  usePageTitle("Contacts");
  const utils = trpc.useUtils();
  const contacts = trpc.crm.contacts.list.useQuery();
  const companies = trpc.crm.companies.list.useQuery();
  const deals = trpc.crm.deals.list.useQuery();
  const activities = trpc.crm.activities.list.useQuery({ limit: 100 });
  const create = trpc.crm.contacts.create.useMutation({
    onSuccess: () => void utils.crm.contacts.invalidate(),
  });
  const upsertEdge = trpc.crm.contacts.edges.upsert.useMutation({
    onSuccess: () => void utils.crm.contacts.edges.invalidate(),
  });

  const [search, setSearch] = useState("");
  const [companyId, setCompanyId] = useState("all");
  const [verify, setVerify] = useState("all");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null,
  );
  const [edgeTo, setEdgeTo] = useState("");
  const [edgeRelation, setEdgeRelation] = useState("knows");

  const edges = trpc.crm.contacts.edges.list.useQuery(
    { contactId: selectedContactId! },
    { enabled: Boolean(selectedContactId) },
  );

  const companyMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of companies.data ?? []) m.set(c.companyId, c.name);
    return m;
  }, [companies.data]);

  const contactName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contacts.data ?? []) {
      m.set(
        c.contactId,
        `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`,
      );
    }
    return m;
  }, [contacts.data]);

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

  const otherContacts = (contacts.data ?? []).filter(
    (c) => c.contactId !== selectedContactId,
  );

  return (
    <main>
      <CrmPageHeader
        kicker="Directory"
        title="Contacts"
        description="Verified people, linked to companies, deals, and who-knows-whom relationships."
        actions={
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

      {contacts.isLoading ? (
        <CrmEmpty title="Loading contacts…" />
      ) : rows.length === 0 ? (
        <CrmEmpty
          title="No contacts yet"
          hint="Add people linked to companies and deals."
        />
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
                <th>Graph</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const full = `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`;
                const selected = selectedContactId === c.contactId;
                return (
                  <tr
                    key={c.contactId}
                    className={selected ? "crm-row-selected" : undefined}
                  >
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
                    <td>
                      <CrmBtn
                        variant={selected ? "primary" : "ghost"}
                        onClick={() =>
                          setSelectedContactId(
                            selected ? null : c.contactId,
                          )
                        }
                      >
                        {selected ? "Close" : "Edges"}
                      </CrmBtn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CrmTableShell>
      )}

      {selectedContactId ? (
        <section className="mt-6 rounded-xl border border-sand bg-paper-2 p-5">
          <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-ochre">
                Relationship graph
              </p>
              <h2 className="mt-1 font-display text-xl font-semibold">
                {contactName.get(selectedContactId) ?? "Contact"} · who knows whom
              </h2>
              <p className="mt-1 text-sm text-muted">
                Edges persist in Postgres (`contact_edges`) when DATABASE_URL is
                set — used later for lead intelligence retrieval.
              </p>
            </div>
          </header>

          <form
            className="mb-4 grid gap-2 md:grid-cols-[1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              if (!edgeTo) return;
              void upsertEdge.mutateAsync({
                fromContact: selectedContactId,
                toContact: edgeTo,
                relation: edgeRelation.trim() || "knows",
                weight: 0.5,
              });
            }}
          >
            <select
              aria-label="Related contact"
              className="rounded-lg border border-sand bg-paper px-3 py-2 text-sm"
              value={edgeTo}
              onChange={(e) => setEdgeTo(e.target.value)}
              required
            >
              <option value="">Link to contact…</option>
              {otherContacts.map((c) => (
                <option key={c.contactId} value={c.contactId}>
                  {c.firstName}
                  {c.lastName ? ` ${c.lastName}` : ""}
                  {c.email ? ` · ${c.email}` : ""}
                </option>
              ))}
            </select>
            <input
              aria-label="Relation"
              className="rounded-lg border border-sand bg-paper px-3 py-2 text-sm"
              placeholder="Relation (knows, introduced, reports_to…)"
              value={edgeRelation}
              onChange={(e) => setEdgeRelation(e.target.value)}
              maxLength={80}
              required
            />
            <CrmBtn
              type="submit"
              variant="primary"
              disabled={upsertEdge.isPending || !edgeTo}
            >
              Save edge
            </CrmBtn>
          </form>

          {upsertEdge.error ? (
            <p className="mb-3 text-sm text-red-700">
              {upsertEdge.error.message}
            </p>
          ) : null}

          {edges.isLoading ? (
            <p className="text-sm text-muted">Loading edges…</p>
          ) : (edges.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">
              No relationships recorded yet. Link a contact above.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(edges.data ?? []).map((edge) => {
                const otherId =
                  edge.fromContact === selectedContactId
                    ? edge.toContact
                    : edge.fromContact;
                const direction =
                  edge.fromContact === selectedContactId ? "→" : "←";
                return (
                  <li
                    key={edge.contactEdgeId}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-sand/70 pt-2"
                  >
                    <span>
                      <strong>{direction}</strong>{" "}
                      {contactName.get(otherId) ?? otherId.slice(0, 8)}
                      <span className="text-muted"> · {edge.relation}</span>
                    </span>
                    <span className="text-xs text-muted">
                      weight {edge.weight.toFixed(2)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </main>
  );
}
