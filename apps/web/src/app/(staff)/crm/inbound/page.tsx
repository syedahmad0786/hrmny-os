"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  CrmBtn,
  CrmEmpty,
  CrmPageHeader,
  CrmTableShell,
  CrmTag,
} from "@/components/crm/ui";
import { formatLane } from "@/components/crm/format";

export default function CrmInboundPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const deals = trpc.crm.deals.list.useQuery();
  const companies = trpc.crm.companies.list.useQuery();
  const contacts = trpc.crm.contacts.list.useQuery();

  const createCompany = trpc.crm.companies.create.useMutation();
  const createContact = trpc.crm.contacts.create.useMutation();
  const createDeal = trpc.crm.deals.create.useMutation();
  const createNote = trpc.crm.notes.create.useMutation();

  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [sector, setSector] = useState("Retail");
  const [market, setMarket] = useState<"UAE" | "KSA" | "Both">("UAE");
  const [message, setMessage] = useState("");
  const [useExistingCompany, setUseExistingCompany] = useState(true);
  const [useExistingContact, setUseExistingContact] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ids created by a previous, partially-failed submit. A retry reuses them
  // instead of re-creating the company/contact/deal. Cleared whenever an
  // identity field changes (the stored ids would no longer match the form).
  const created = useRef<{
    companyId?: string;
    companyName?: string;
    contactId?: string;
    dealId?: string;
  }>({});
  const resetCreated = () => {
    created.current = {};
  };

  // Dedupe courtesy: match against live CRM data before creating anything.
  const companyMatch = useMemo(() => {
    const key = companyName.trim().toLowerCase();
    if (!key) return null;
    return (
      (companies.data ?? []).find(
        (c) => c.name.trim().toLowerCase() === key,
      ) ?? null
    );
  }, [companies.data, companyName]);

  const contactMatch = useMemo(() => {
    const key = contactEmail.trim().toLowerCase();
    if (!key) return null;
    return (
      (contacts.data ?? []).find(
        (c) => (c.email ?? "").trim().toLowerCase() === key,
      ) ?? null
    );
  }, [contacts.data, contactEmail]);

  const inboundDeals = (deals.data ?? []).filter(
    (d) => d.stage === "discover",
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // 1. Company — reuse a prior partial submit, then the matched one
      // unless staff opted out.
      let companyId = created.current.companyId;
      let dealCompanyName = created.current.companyName;
      if (!companyId || !dealCompanyName) {
        if (companyMatch && useExistingCompany) {
          companyId = companyMatch.companyId;
          dealCompanyName = companyMatch.name;
        } else {
          const co = await createCompany.mutateAsync({
            name: companyName.trim(),
            sector: sector.trim() || null,
            market,
          });
          companyId = co.companyId;
          dealCompanyName = co.name;
        }
        created.current.companyId = companyId;
        created.current.companyName = dealCompanyName;
      }

      // 2. Contact — reuse prior partial submit, then email match unless
      // staff opted out.
      let contactId = created.current.contactId;
      if (!contactId) {
        if (contactMatch && useExistingContact) {
          contactId = contactMatch.contactId;
        } else {
          const [firstName, ...rest] = contactName.trim().split(/\s+/);
          const ct = await createContact.mutateAsync({
            companyId,
            firstName: firstName || contactEmail.trim(),
            lastName: rest.length ? rest.join(" ") : null,
            email: contactEmail.trim() || null,
          });
          contactId = ct.contactId;
        }
        created.current.contactId = contactId;
      }

      // 3. Deal on the live CRM lane (reused if only the note failed).
      let dealId = created.current.dealId;
      if (!dealId) {
        const deal = await createDeal.mutateAsync({
          companyName: dealCompanyName,
          companyId,
          primaryContactId: contactId,
          sector: sector.trim() || null,
          leadSourceLane: "inbound",
        });
        dealId = deal.dealId;
        created.current.dealId = dealId;
      }

      // 4. Capture the enquiry + market on the deal.
      await createNote.mutateAsync({
        dealId,
        companyId,
        contactId,
        body: `Inbound enquiry · market ${market}${
          message.trim() ? `\n\n${message.trim()}` : ""
        }`,
      });

      resetCreated();
      await utils.crm.invalidate();
      router.push(`/crm/deals/${dealId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create lead");
      setSubmitting(false);
      // Partial creates are real rows now — refresh lists + dedupe matchers.
      await utils.crm.invalidate();
    }
  }

  return (
    <main>
      <CrmPageHeader
        title="Inbound leads"
        description="Review new interest before creating a clean company, contact and deal."
      />

      <section className="crm-split">
        <div className="crm-panel">
          <div className="crm-panel-head">
            <div>
              <h3>Capture lead</h3>
              <p>Creates a real company, contact and discover-stage deal</p>
            </div>
          </div>
          <div className="crm-panel-body">
            <form className="crm-form-grid" onSubmit={handleSubmit}>
              <div className="crm-field">
                <label>Company</label>
                <input
                  className="crm-input"
                  required
                  value={companyName}
                  onChange={(e) => {
                    resetCreated();
                    setCompanyName(e.target.value);
                  }}
                />
                {companyMatch ? (
                  <label className="mt-1 flex items-center gap-2 text-[11px] text-[var(--muted)]">
                    <input
                      type="checkbox"
                      checked={useExistingCompany}
                      onChange={(e) => {
                        resetCreated();
                        setUseExistingCompany(e.target.checked);
                      }}
                    />
                    Use existing company “{companyMatch.name}”
                  </label>
                ) : null}
              </div>
              <div className="crm-field">
                <label>Contact name</label>
                <input
                  className="crm-input"
                  required={!(contactMatch && useExistingContact)}
                  value={contactName}
                  onChange={(e) => {
                    resetCreated();
                    setContactName(e.target.value);
                  }}
                />
              </div>
              <div className="crm-field">
                <label>Email</label>
                <input
                  className="crm-input"
                  required
                  type="email"
                  value={contactEmail}
                  onChange={(e) => {
                    resetCreated();
                    setContactEmail(e.target.value);
                  }}
                />
                {contactMatch ? (
                  <label className="mt-1 flex items-center gap-2 text-[11px] text-[var(--muted)]">
                    <input
                      type="checkbox"
                      checked={useExistingContact}
                      onChange={(e) => {
                        resetCreated();
                        setUseExistingContact(e.target.checked);
                      }}
                    />
                    Use existing contact {contactMatch.firstName}
                    {contactMatch.lastName ? ` ${contactMatch.lastName}` : ""}
                  </label>
                ) : null}
              </div>
              <div className="crm-field">
                <label>Sector / interest</label>
                <input
                  className="crm-input"
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                />
              </div>
              <div className="crm-field">
                <label>Market</label>
                <select
                  className="crm-select"
                  value={market}
                  onChange={(e) =>
                    setMarket(e.target.value as "UAE" | "KSA" | "Both")
                  }
                >
                  <option>UAE</option>
                  <option>KSA</option>
                  <option>Both</option>
                </select>
              </div>
              <div className="crm-field wide">
                <label>Message</label>
                <textarea
                  className="crm-textarea"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
              <div className="crm-field wide">
                <CrmBtn variant="primary" disabled={submitting} type="submit">
                  {submitting ? "Creating…" : "Review + create deal"}
                </CrmBtn>
                {error ? (
                  <div className="crm-note mt-3" role="alert">
                    <CrmTag kind="danger">Failed</CrmTag> {error}
                  </div>
                ) : null}
              </div>
            </form>
          </div>
        </div>

        <aside className="crm-panel">
          <div className="crm-panel-head">
            <h3>Recent discover deals</h3>
          </div>
          <div className="crm-panel-body">
            {deals.isLoading ? (
              <CrmEmpty title="Loading…" />
            ) : deals.error ? (
              <CrmEmpty title="Could not load deals" hint={deals.error.message} />
            ) : inboundDeals.length === 0 ? (
              <CrmEmpty title="No inbound yet" />
            ) : (
              <div className="crm-checklist">
                {inboundDeals.slice(0, 6).map((d) => (
                  <Link
                    key={d.dealId}
                    href={`/crm/deals/${d.dealId}`}
                    className="crm-check-row"
                  >
                    <strong>{d.companyName}</strong>
                    <span>
                      <CrmTag kind="info">{d.stage}</CrmTag>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </aside>
      </section>

      <div className="mt-4">
        <CrmTableShell foot="Inbound form → company + contact + discover deal (live)">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Interest</th>
                <th>Lane</th>
                <th>Stage</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {inboundDeals.length === 0 ? (
                <tr>
                  <td colSpan={5}>No discover-stage deals yet.</td>
                </tr>
              ) : (
                inboundDeals.map((d) => (
                  <tr key={d.dealId}>
                    <td>
                      <strong>{d.companyName}</strong>
                    </td>
                    <td>{d.sector ?? "—"}</td>
                    <td>
                      <CrmTag kind="info">{formatLane(d.leadSourceLane)}</CrmTag>
                    </td>
                    <td>{d.stage}</td>
                    <td>
                      <Link href={`/crm/deals/${d.dealId}`}>
                        <CrmBtn variant="primary">Open deal</CrmBtn>
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CrmTableShell>
      </div>
    </main>
  );
}
