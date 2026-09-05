"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { CrmBtn, CrmEmpty, CrmPageHeader } from "./ui";
import { CRM_MARKETS, type CrmMarket } from "@/lib/crm-markets";
import { safeExternalUrl } from "@/lib/crm-workbook";

export function CrmRecordDetail({ kind }: { kind: "contacts" | "companies" }) {
  const { id } = useParams<{ id: string }>(),
    utils = trpc.useUtils();
  const router = useRouter();
  const isContact = kind === "contacts";
  const contact = trpc.crm.contacts.get.useQuery(
    { id },
    { enabled: isContact },
  );
  const company = trpc.crm.companies.get.useQuery(
    { id },
    { enabled: !isContact },
  );
  const companies = trpc.crm.companies.list.useQuery();
  const contacts = trpc.crm.contacts.list.useQuery();
  const deals = trpc.crm.deals.list.useQuery();
  const tasks = trpc.crm.tasks.list.useQuery();
  const activities = trpc.crm.activities.list.useQuery({
    ...(isContact ? { contactId: id } : { companyId: id }),
    limit: 100,
  });
  const [form, setForm] = useState<Record<string, string>>({}),
    [message, setMessage] = useState("");
  const [action, setAction] = useState(""),
    [due, setDue] = useState("");
  const [note, setNote] = useState(""),
    [activityType, setActivityType] = useState<"note" | "call" | "meeting">(
      "note",
    );
  const [occurredAt, setOccurredAt] = useState("");
  const refresh = async () => {
    setMessage("Saved.");
    await utils.crm.invalidate();
  };
  const saveContact = trpc.crm.contacts.update.useMutation({
    onSuccess: refresh,
  });
  const saveCompany = trpc.crm.companies.update.useMutation({
    onSuccess: refresh,
  });
  const createTask = trpc.crm.tasks.create.useMutation({
    onSuccess: async () => {
      setAction("");
      setDue("");
      await refresh();
    },
  });
  const createActivity = trpc.crm.activities.create.useMutation({
    onSuccess: async () => {
      setNote("");
      await refresh();
    },
  });
  const createDeal = trpc.crm.deals.create.useMutation({
    onSuccess: (deal) => router.push(`/crm/deals/${deal.dealId}`),
  });
  const record = isContact ? contact.data : company.data;
  const companyId = isContact ? contact.data?.companyId : id;
  const linkedDeals = (deals.data ?? []).filter((d) =>
    isContact ? d.primaryContactId === id : d.companyId === id,
  );
  const linkedTasks = (tasks.data ?? []).filter((t) =>
    isContact
      ? t.contactId === id
      : t.companyId === id || linkedDeals.some((d) => d.dealId === t.dealId),
  );
  const lastInteraction = isContact
    ? contacts.data?.find((c) => c.contactId === id)?.lastInteractionAt
    : null;
  useEffect(() => {
    if (!record) return;
    setForm(
      Object.fromEntries(
        Object.entries(record)
          .filter(([, value]) => value == null || typeof value === "string")
          .map(([key, value]) => [key, String(value ?? "")]),
      ),
    );
  }, [record]);
  if ((isContact ? contact : company).isLoading)
    return <CrmEmpty title="Loading record…" />;
  if ((isContact ? contact : company).error)
    return <p role="alert">Could not load this record.</p>;
  if (!record) return <CrmEmpty title="Record not found" />;
  const name = isContact
    ? `${contact.data?.firstName} ${contact.data?.lastName ?? ""}`.trim()
    : (company.data?.name ?? "");
  const editField = (
    key: string,
    label: string,
    type = "text",
    required = false,
  ) => (
    <label key={key}>
      {label}
      <input
        type={type}
        required={required}
        maxLength={key === "email" ? 320 : 1000}
        value={form[key] ?? ""}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );
  const error =
    saveContact.error ??
    saveCompany.error ??
    createTask.error ??
    createActivity.error ??
    createDeal.error;
  return (
    <main className="crm-workbook">
      <Link className="text-ochre underline" href={`/crm/${kind}`}>
        ← {isContact ? "Contacts" : "Companies"}
      </Link>
      <CrmPageHeader
        title={name}
        description={
          isContact
            ? `Last interaction: ${lastInteraction ? new Date(lastInteraction).toLocaleDateString() : "not recorded"}. Record updates do not count as contact.`
            : "People, opportunities and commitments in one company record."
        }
        actions={
          <>
            {safeExternalUrl(record.linkedinUrl) ? (
              <a
                className="crm-btn"
                href={safeExternalUrl(record.linkedinUrl)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open LinkedIn profile
              </a>
            ) : null}
            {!isContact && safeExternalUrl(company.data?.website) ? (
              <a
                className="crm-btn"
                href={safeExternalUrl(company.data?.website)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Company website
              </a>
            ) : null}
            <Link
              className="crm-btn"
              href={`/crm/workbook?tab=${kind}&q=${encodeURIComponent(name)}`}
            >
              Owner and workbook
            </Link>
            <CrmBtn
              variant="primary"
              disabled={createDeal.isPending || !companyId}
              onClick={() =>
                createDeal.mutate({
                  companyName:
                    companies.data?.find((c) => c.companyId === companyId)
                      ?.name ?? name,
                  companyId: companyId!,
                  primaryContactId: isContact ? id : null,
                  leadSourceLane: "relationship_led",
                })
              }
            >
              Create opportunity
            </CrmBtn>
          </>
        }
      />
      {isContact && companyId ? (
        <p>
          Company:{" "}
          <Link
            className="text-ochre underline"
            href={`/crm/companies/${companyId}`}
          >
            {companies.data?.find((c) => c.companyId === companyId)?.name ??
              "Open company"}
          </Link>
        </p>
      ) : null}
      {isContact &&
      !contact.data?.email &&
      contact.data?.firstName.includes("@") ? (
        <p className="workbook-selection">
          This imported record has an email in its name field. Review the
          person’s name and move the address into Work email before saving.
        </p>
      ) : null}
      <form
        className="crm-record-form"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage("");
          if (isContact)
            saveContact.mutate({
              id,
              firstName: form.firstName!.trim(),
              lastName: form.lastName?.trim() || null,
              email: form.email?.trim() || null,
              phone: form.phone?.trim() || null,
              title: form.title?.trim() || null,
              companyId: form.companyId || null,
              linkedinUrl: form.linkedinUrl?.trim() || null,
            });
          else
            saveCompany.mutate({
              id,
              name: form.name!.trim(),
              sector: form.sector?.trim() || null,
              website: form.website?.trim() || null,
              linkedinUrl: form.linkedinUrl?.trim() || null,
              market: form.market as CrmMarket,
            });
        }}
      >
        {isContact ? (
          <>
            {editField("firstName", "First name", "text", true)}
            {editField("lastName", "Last name")}
            {editField("email", "Work email", "email")}
            {editField("phone", "Phone")}
            {editField("title", "Role")}
            <label>
              Company
              <select
                value={form.companyId ?? ""}
                onChange={(e) =>
                  setForm({ ...form, companyId: e.target.value })
                }
              >
                <option value="">Not linked</option>
                {companies.data?.map((c) => (
                  <option key={c.companyId} value={c.companyId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            {editField("name", "Company name", "text", true)}
            {editField("sector", "Sector")}
            {editField("website", "Website")}
            <label>
              Market
              <select
                value={form.market ?? "UAE"}
                onChange={(e) => setForm({ ...form, market: e.target.value })}
              >
                {CRM_MARKETS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
          </>
        )}
        {editField("linkedinUrl", "LinkedIn profile URL")}
        <div className="workbook-actions">
          <CrmBtn
            variant="primary"
            type="submit"
            disabled={saveContact.isPending || saveCompany.isPending}
          >
            Save record
          </CrmBtn>
        </div>
      </form>
      {isContact ? (
        <p className="text-sm text-muted">
          {contact.data?.emailVerified
            ? "Current email is verified."
            : "Work email needs verification before outreach."}{" "}
          Changing the address resets its verification.
        </p>
      ) : null}
      {message || error ? (
        <p role={error ? "alert" : "status"}>{error?.message ?? message}</p>
      ) : null}
      {!isContact ? (
        <section className="crm-record-section">
          <h2>People</h2>
          <ul>
            {contacts.data
              ?.filter((c) => c.companyId === id)
              .map((c) => (
                <li key={c.contactId}>
                  <Link href={`/crm/contacts/${c.contactId}`}>
                    {c.firstName} {c.lastName}
                  </Link>{" "}
                  · {c.title || "Role not recorded"}
                </li>
              ))}
          </ul>
          <Link href={`/crm/contacts?q=${encodeURIComponent(name)}`}>
            Open contacts workbook
          </Link>
        </section>
      ) : null}
      <section className="crm-record-section">
        <h2>Opportunities</h2>
        {linkedDeals.length ? (
          <ul>
            {linkedDeals.map((d) => (
              <li key={d.dealId}>
                <Link href={`/crm/deals/${d.dealId}`}>
                  {d.opportunityName || d.companyName}
                </Link>{" "}
                · {d.closeOutcome ?? d.stage}
              </li>
            ))}
          </ul>
        ) : (
          <p>No linked opportunities yet.</p>
        )}
        <Link href={`/crm/leads?q=${encodeURIComponent(name)}`}>
          Open leads
        </Link>
      </section>
      <section className="crm-record-section">
        <h2>Next actions</h2>
        <ul>
          {linkedTasks.map((t) => (
            <li key={t.crmTaskId}>
              <Link href={`/crm/followups?record=${t.crmTaskId}`}>
                {t.title}
              </Link>{" "}
              · {t.status} · {t.dueDate || "No date"}
            </li>
          ))}
        </ul>
        <form
          className="workbook-tools"
          onSubmit={(e) => {
            e.preventDefault();
            createTask.mutate({
              title: action,
              dueDate: due,
              companyId: companyId || null,
              contactId: isContact ? id : null,
            });
          }}
        >
          <label>
            Next action
            <input
              required
              maxLength={300}
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
          </label>
          <label>
            Due date
            <input
              type="date"
              required
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <CrmBtn type="submit" disabled={createTask.isPending}>
            Add follow-up
          </CrmBtn>
        </form>
      </section>
      <section className="crm-record-section">
        <h2>Shared activity</h2>
        <p className="text-sm text-muted">
          Log calls, meetings and team notes here. Email content remains in the
          authorized person’s private inbox.
        </p>
        <form
          className="workbook-tools"
          onSubmit={(e) => {
            e.preventDefault();
            createActivity.mutate({
              type: activityType,
              subject: note,
              companyId: companyId || null,
              contactId: isContact ? id : null,
              ...(occurredAt
                ? { occurredAt: new Date(occurredAt).toISOString() }
                : {}),
            });
          }}
        >
          <label>
            Activity
            <select
              value={activityType}
              onChange={(e) =>
                setActivityType(e.target.value as typeof activityType)
              }
            >
              <option value="note">Team note</option>
              <option value="call">Completed call</option>
              <option value="meeting">Completed meeting</option>
            </select>
          </label>
          <label>
            Summary
            <input
              value={note}
              maxLength={1000}
              required
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <label>
            When
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </label>
          <CrmBtn type="submit" disabled={createActivity.isPending}>
            Log activity
          </CrmBtn>
        </form>
        <ul>
          {activities.data?.map((a) => (
            <li key={a.activityId}>
              <strong>{a.subject || a.type}</strong>
              <p>{a.body}</p>
              <small>{new Date(a.occurredAt).toLocaleString()}</small>
            </li>
          ))}
        </ul>
        {activities.error ? <p role="alert">Activity could not load.</p> : null}
      </section>
    </main>
  );
}
