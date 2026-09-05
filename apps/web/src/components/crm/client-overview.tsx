"use client";
import Link from "next/link";
import { trpc } from "@/lib/trpc";

export function ClientOverview({
  clientId,
  dealId,
}: {
  clientId: string;
  dealId: string | null;
}) {
  const snapshot = trpc.crm.workbook.snapshot.useQuery();
  const deals = trpc.crm.deals.list.useQuery();
  const contacts = trpc.crm.contacts.list.useQuery();
  const sources = trpc.clients.sourceProjects.useQuery({ clientId });
  const clients = trpc.clients.list.useQuery();
  const client = snapshot.data?.rows.find(
    (row) => row.kind === "clients" && row.id === clientId,
  );
  const origin = deals.data?.find((deal) => deal.dealId === dealId);
  const companyId = origin?.companyId;
  const engagements =
    snapshot.data?.rows.filter(
      (row) =>
        row.kind === "clients" &&
        !row.test &&
        (row.id === clientId ||
          Boolean(
            companyId &&
            deals.data?.some(
              (d) =>
                d.companyId === companyId &&
                clients.data?.some(
                  (c) => c.clientId === row.id && c.dealId === d.dealId,
                ),
            ),
          )),
    ) ?? [];
  const opportunities =
    deals.data?.filter((deal) =>
      companyId ? deal.companyId === companyId : deal.dealId === dealId,
    ) ?? [];
  if (snapshot.isLoading) return <p>Loading account overview…</p>;
  if (snapshot.error)
    return (
      <p role="alert">
        Account overview could not load: {snapshot.error.message}
      </p>
    );
  if (!client) return null;
  return (
    <section
      id="overview"
      className="crm-record-section"
      data-testid="client-account-overview"
    >
      <h2>Account overview</h2>
      {sources.error ? (
        <p role="alert">
          Source projects could not load: {sources.error.message}
        </p>
      ) : null}
      {sources.data?.length ? (
        <div className="my-4 rounded-lg border border-sand p-3">
          <h3 className="font-semibold">Asana client projects</h3>
          <p className="text-sm text-muted">
            Imported from active Asana projects. Commercial terms and account
            ownership need review; project activity does not establish current
            billing.
          </p>
          <ul>
            {sources.data.map((p) => (
              <li key={p.projectId}>
                <a
                  className="underline"
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {p.projectName}
                </a>{" "}
                <span className="text-xs text-muted">
                  · observed {p.observedAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <nav className="workbook-actions" aria-label="Client sections">
        <a href="#client-people">People</a>
        <a href="#client-engagements">Engagements</a>
        <Link href={`/delivery?clientId=${clientId}`}>Delivery and files</Link>
        <a href="#onboarding">Onboarding</a>
        <Link
          href={`/crm/workbook?tab=clients&q=${encodeURIComponent(client.name)}`}
        >
          Manage account lead, status and renewal
        </Link>
      </nav>
      <dl className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div>
          <dt className="text-sm text-muted">Account lead</dt>
          <dd className="font-semibold">{client.owner}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Relationship status</dt>
          <dd className="font-semibold">
            {client.status.replaceAll("_", " ")}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Renewal</dt>
          <dd className="font-semibold">{client.renewal || "Not recorded"}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Engagement value</dt>
          <dd className="font-semibold">
            {client.value
              ? `${client.currency} ${Number(client.value).toLocaleString()}`
              : "Not recorded"}
          </dd>
        </div>
      </dl>
      <p className="mt-5 rounded-lg bg-cream p-3">
        <strong>Next action: </strong>
        {client.nextAction || "Plan the next account action"}
        {client.due ? ` · ${client.due}` : ""} ·{" "}
        <Link
          href={dealId ? `/crm/deals/${dealId}#next-action` : "/crm/followups"}
        >
          Plan follow-up
        </Link>
      </p>
      {companyId ? (
        <p className="mt-3">
          Company:{" "}
          <Link href={`/crm/companies/${companyId}`}>{client.company}</Link>
        </p>
      ) : (
        <p className="mt-3 text-sm text-muted">
          Link the originating sales deal to the company to connect its people
          and other engagements.
        </p>
      )}
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div id="client-people">
          <h3 className="font-semibold">People</h3>
          <ul>
            {contacts.data
              ?.filter((person) =>
                companyId
                  ? person.companyId === companyId
                  : person.contactId === origin?.primaryContactId,
              )
              .map((person) => (
                <li key={person.contactId}>
                  <Link href={`/crm/contacts/${person.contactId}`}>
                    {person.firstName} {person.lastName}
                  </Link>{" "}
                  · {person.title || "Role not recorded"}
                </li>
              ))}
          </ul>
        </div>
        <div id="client-engagements">
          <h3 className="font-semibold">Engagements and opportunities</h3>
          <ul>
            {engagements.map((row) => (
              <li key={row.id}>
                <Link href={row.href}>{row.name}</Link> · {row.status}
              </li>
            ))}
            {opportunities
              .filter((opportunity) => !opportunity.closeOutcome)
              .map((opportunity) => (
                <li key={opportunity.dealId}>
                  <Link href={`/crm/deals/${opportunity.dealId}`}>
                    {opportunity.opportunityName || opportunity.companyName}
                  </Link>{" "}
                  · {opportunity.stage}
                </li>
              ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
