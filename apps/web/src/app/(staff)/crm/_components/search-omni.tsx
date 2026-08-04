"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

type Item = { href: string; primary: string; secondary?: string };

function Section({
  title,
  items,
  onPick,
}: {
  title: string;
  items: Item[];
  onPick: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="py-1">
      <p className="px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
        {title}
      </p>
      {items.map((item) => (
        <Link
          key={item.href + item.primary}
          href={item.href}
          onClick={onPick}
          className="block rounded-[9px] px-3 py-2 hover:bg-[var(--muted-surface-soft)]"
        >
          <strong className="block text-[11px]">{item.primary}</strong>
          {item.secondary ? (
            <small className="block text-[9px] text-[var(--muted)]">
              {item.secondary}
            </small>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

/** W6 omni-search: debounced crm.search.omni with grouped results. Esc closes. */
export function CrmOmniSearch() {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const search = trpc.crm.search.omni.useQuery(
    { q },
    { enabled: q.length > 0 },
  );

  const close = () => {
    setOpen(false);
    setInput("");
  };

  const r = search.data;
  const total = r ? r.companies.length + r.contacts.length + r.deals.length : 0;

  return (
    <div ref={boxRef} className="relative min-w-[240px] max-w-[520px] flex-1">
      <input
        className="crm-input w-full"
        placeholder="Search companies, contacts and deals…"
        value={input}
        aria-label="Search CRM"
        onChange={(e) => {
          setInput(e.target.value);
          setOpen(e.target.value.trim().length > 0);
        }}
        onFocus={() => {
          if (input.trim()) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
      />
      {open && q.length > 0 ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 max-h-[380px] overflow-auto rounded-[13px] border border-[var(--line)] bg-[var(--paper-2)] p-1 shadow-[var(--shadow)]">
          {search.isLoading ? (
            <p className="px-3 py-3 text-[11px] text-[var(--muted)]">
              Searching…
            </p>
          ) : search.error ? (
            <p className="px-3 py-3 text-[11px] text-[var(--danger)]" role="alert">
              Search failed: {search.error.message}
            </p>
          ) : total === 0 ? (
            <p className="px-3 py-3 text-[11px] text-[var(--muted)]">
              No matches for “{q}”
            </p>
          ) : (
            <>
              <Section
                title="Companies"
                onPick={close}
                items={(r?.companies ?? []).map((c) => ({
                  href: `/crm/companies?q=${encodeURIComponent(c.name)}`,
                  primary: c.name,
                  secondary: c.sector ?? undefined,
                }))}
              />
              <Section
                title="Contacts"
                onPick={close}
                items={(r?.contacts ?? []).map((c) => ({
                  href: `/crm/contacts?q=${encodeURIComponent(
                    c.email ?? `${c.firstName} ${c.lastName ?? ""}`.trim(),
                  )}`,
                  primary: `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`,
                  secondary: c.email ?? undefined,
                }))}
              />
              <Section
                title="Deals"
                onPick={close}
                items={(r?.deals ?? []).map((d) => ({
                  href: `/crm/deals/${d.dealId}`,
                  primary: d.companyName,
                  secondary: `${String(d.stage).replace(/_/g, " ")}${
                    d.sector ? ` · ${d.sector}` : ""
                  }`,
                }))}
              />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
