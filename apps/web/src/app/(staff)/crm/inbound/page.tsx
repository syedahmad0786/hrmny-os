"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  CrmBtn,
  CrmEmpty,
  CrmPageHeader,
  CrmTableShell,
  CrmTag,
} from "@/components/crm/ui";

export default function CrmInboundPage() {
  const utils = trpc.useUtils();
  const deals = trpc.crm.deals.list.useQuery();
  const create = trpc.leads.inbound.create.useMutation({
    onSuccess: () => {
      void utils.crm.deals.invalidate();
      void utils.deals.invalidate();
    },
  });

  const [companyName, setCompanyName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [sector, setSector] = useState("Retail");
  const [message, setMessage] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);

  const inboundDeals = (deals.data ?? []).filter(
    (d) =>
      d.leadSourceLane === "relationship_led" ||
      d.stage === "discover",
  );

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
              <p>Creates a discover-stage deal on the live CRM lane</p>
            </div>
          </div>
          <div className="crm-panel-body">
            <form
              className="crm-form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                const deal = await create.mutateAsync({
                  companyName,
                  contactEmail,
                  sector,
                  message,
                });
                setCreatedId(deal.dealId);
                setCompanyName("");
                setContactEmail("");
                setMessage("");
              }}
            >
              <div className="crm-field">
                <label>Company</label>
                <input
                  className="crm-input"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>
              <div className="crm-field">
                <label>Email</label>
                <input
                  className="crm-input"
                  required
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
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
                <select className="crm-select" defaultValue="UAE">
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
                <CrmBtn
                  variant="primary"
                  disabled={create.isPending}
                  type="submit"
                >
                  Review + create deal
                </CrmBtn>
                {createdId ? (
                  <p className="mt-3 text-[11px]">
                    Created{" "}
                    <Link className="text-[var(--ochre-dark)]" href={`/crm/deals/${createdId}`}>
                      {createdId}
                    </Link>
                  </p>
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
            {(inboundDeals ?? []).length === 0 ? (
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
        <CrmTableShell foot="Inbound form → discover deal (live)">
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
              {(deals.data ?? [])
                .filter((d) => d.stage === "discover")
                .map((d) => (
                  <tr key={d.dealId}>
                    <td>
                      <strong>{d.companyName}</strong>
                    </td>
                    <td>{d.sector ?? "—"}</td>
                    <td>
                      <CrmTag kind="info">{d.leadSourceLane.replace(/_/g, " ")}</CrmTag>
                    </td>
                    <td>{d.stage}</td>
                    <td>
                      <Link href={`/crm/deals/${d.dealId}`}>
                        <CrmBtn variant="primary">Open deal</CrmBtn>
                      </Link>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </CrmTableShell>
      </div>
    </main>
  );
}
