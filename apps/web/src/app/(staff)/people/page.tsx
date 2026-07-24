"use client";

import { Button } from "@hrmny/ui";
import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

type EmployeeRow = {
  employee_id: string;
  display_name: string;
  email: string;
  job_title: string | null;
  department: string | null;
};

type AssetRow = {
  company_asset_id: string;
  asset_tag: string;
  name: string;
  status: string;
};

type LetterRow = {
  employee_letter_request_id: string;
  letter_type: string;
  status: string;
  created_at: string;
};

export default function PeoplePage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const employeeQuery = trpc.coreHr.employees.useQuery();
  const assetQuery = trpc.coreHr.assets.list.useQuery();
  const letterQuery = trpc.coreHr.letters.list.useQuery();
  const createLetter = trpc.coreHr.letters.create.useMutation({
    onSuccess: () => void utils.coreHr.letters.list.invalidate(),
  });
  const [letterType, setLetterType] = useState("Salary certificate");
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [roleKey, setRoleKey] = useState<
    | "staff"
    | "account_manager"
    | "project_manager"
    | "director"
    | "partner"
    | "hr"
  >("staff");
  const inviteEmployee = trpc.coreHr.inviteEmployee.useMutation({
    onSuccess: async () => {
      setDisplayName("");
      setEmail("");
      setJobTitle("");
      setDepartment("");
      await utils.coreHr.employees.invalidate();
    },
  });

  const employees = (employeeQuery.data ?? []) as unknown as EmployeeRow[];
  const assets = (assetQuery.data ?? []) as unknown as AssetRow[];
  const letters = (letterQuery.data ?? []) as unknown as LetterRow[];
  const canAddEmployee = (session.data?.roles ?? []).some((role) =>
    ["partner", "director", "hr"].includes(role),
  );

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">People</h1>
          <p className="mt-1 text-sm text-muted">
            Employee records, company assets, onboarding tasks, documents, and
            letters.
          </p>
          <p className="mt-2 text-sm">
            <Link className="underline" href="/time">
              Leave & attendance
            </Link>{" "}
            ·{" "}
            <Link className="underline" href="/work-schedule">
              Schedule & time
            </Link>{" "}
            ·{" "}
            <Link className="underline" href="/talent">
              Talent & performance
            </Link>{" "}
            ·{" "}
            <Link className="underline" href="/workforce-payroll">
              Pay & expenses
            </Link>{" "}
            ·{" "}
            <Link className="underline" href="/benefits">
              Benefits
            </Link>{" "}
            ·{" "}
            <Link className="underline" href="/workplace">
              Workplace
            </Link>
          </p>
        </div>
        {canAddEmployee ? (
          <Button
            type="button"
            onClick={() => setShowAddEmployee((value) => !value)}
          >
            + Add employee
          </Button>
        ) : null}
      </div>

      {showAddEmployee && canAddEmployee ? (
        <form
          className="grid gap-3 rounded-lg border border-sand bg-white/70 p-4 md:grid-cols-2 lg:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            inviteEmployee.mutate({
              displayName,
              email,
              jobTitle: jobTitle || undefined,
              department: department || undefined,
              roleKey,
            });
          }}
        >
          <input
            className="rounded border border-sand bg-white px-3 py-2 text-sm"
            placeholder="Full name"
            minLength={2}
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <input
            className="rounded border border-sand bg-white px-3 py-2 text-sm"
            type="email"
            placeholder="name@hrmny.co"
            pattern=".+@hrmny\.co"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <input
            className="rounded border border-sand bg-white px-3 py-2 text-sm"
            placeholder="Job title (optional)"
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
          />
          <input
            className="rounded border border-sand bg-white px-3 py-2 text-sm"
            placeholder="Department (optional)"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          />
          <select
            aria-label="Employee access role"
            className="rounded border border-sand bg-white px-3 py-2 text-sm"
            value={roleKey}
            onChange={(event) =>
              setRoleKey(event.target.value as typeof roleKey)
            }
          >
            <option value="staff">Staff</option>
            <option value="account_manager">Account manager</option>
            <option value="project_manager">Project manager</option>
            <option value="hr">HR</option>
            <option value="director">Director</option>
            <option value="partner">Partner</option>
          </select>
          <Button type="submit" disabled={inviteEmployee.isPending}>
            {inviteEmployee.isPending ? "Adding…" : "Add & invite"}
          </Button>
          {inviteEmployee.data ? (
            <p
              className="text-sm text-ink md:col-span-2 lg:col-span-3"
              aria-live="polite"
            >
              {inviteEmployee.data.inviteMessage}
            </p>
          ) : null}
          {inviteEmployee.error ? (
            <p className="text-sm text-red-700 md:col-span-2 lg:col-span-3">
              {inviteEmployee.error.message}
            </p>
          ) : null}
        </form>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <Metric label="People in view" value={employees.length} />
        <Metric label="Assets in view" value={assets.length} />
        <Metric
          label="Open letter requests"
          value={
            letters.filter(
              (letter) =>
                !["ready", "rejected", "cancelled"].includes(letter.status),
            ).length
          }
        />
      </section>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <h2 className="font-semibold">Employee directory</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Role</th>
                <th className="pb-2 font-medium">Department</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr
                  key={employee.employee_id}
                  className="border-t border-sand/70"
                >
                  <td className="py-3 pr-4">
                    <p className="font-medium">{employee.display_name}</p>
                    <p className="text-xs text-muted">{employee.email}</p>
                  </td>
                  <td className="py-3 pr-4">{employee.job_title ?? "—"}</td>
                  <td className="py-3">{employee.department ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-sand bg-white/70 p-4">
          <h2 className="font-semibold">My company assets</h2>
          <div className="mt-3 space-y-2 text-sm">
            {assets.length ? (
              assets.map((asset) => (
                <div
                  key={asset.company_asset_id}
                  className="flex justify-between border-t border-sand/70 py-2"
                >
                  <span>
                    {asset.name} · {asset.asset_tag}
                  </span>
                  <span className="text-muted">{asset.status}</span>
                </div>
              ))
            ) : (
              <p className="text-muted">No assets assigned.</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-sand bg-white/70 p-4">
          <h2 className="font-semibold">Request an employee letter</h2>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              createLetter.mutate({ letterType });
            }}
          >
            <input
              aria-label="Letter type"
              className="min-w-0 flex-1 rounded border border-sand bg-white px-3 py-2 text-sm"
              value={letterType}
              onChange={(event) => setLetterType(event.target.value)}
              minLength={2}
              maxLength={100}
              required
            />
            <Button type="submit" disabled={createLetter.isPending}>
              Request
            </Button>
          </form>
          <div className="mt-3 space-y-2 text-sm">
            {letters.slice(0, 5).map((letter) => (
              <div
                key={letter.employee_letter_request_id}
                className="flex justify-between border-t border-sand/70 py-2"
              >
                <span>{letter.letter_type}</span>
                <span className="text-muted">{letter.status}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-sand bg-white/70 p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold">{value}</p>
    </div>
  );
}
