"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";

export default function WorkforcePayrollPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const admin = (session.data?.roles ?? []).some((role) =>
    ["partner", "director", "finance", "hr"].includes(role),
  );
  const salary = trpc.workforcePayroll.salary.current.useQuery();
  const expenses = trpc.workforcePayroll.expenses.list.useQuery();
  const loans = trpc.workforcePayroll.loans.list.useQuery();
  const payslips = trpc.workforcePayroll.payslips.list.useQuery();
  const runs = trpc.workforcePayroll.runs.list.useQuery(undefined, {
    enabled: admin,
  });
  const createExpense = trpc.workforcePayroll.expenses.create.useMutation({
    onSuccess: () => void utils.workforcePayroll.expenses.list.invalidate(),
  });
  const createLoan = trpc.workforcePayroll.loans.create.useMutation({
    onSuccess: () => void utils.workforcePayroll.loans.list.invalidate(),
  });
  const [expense, setExpense] = useState({
    date: "",
    category: "Travel",
    description: "",
    amount: "",
  });
  const [loan, setLoan] = useState({
    purpose: "",
    principal: "",
    instalment: "",
  });
  const [message, setMessage] = useState("");

  const submit = async (work: () => Promise<unknown>) => {
    try {
      await work();
      setMessage("Saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save");
    }
  };

  return (
    <main className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-semibold">Pay & expenses</h1>
        <p className="mt-1 text-sm text-muted">
          Salary details, expense reimbursement, employee loans, payroll and
          payslips.
        </p>
        {message ? <p className="mt-2 text-sm">{message}</p> : null}
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        <Metric
          label="Basic salary"
          value={
            salary.data
              ? `${salary.data.basicMonthly} ${salary.data.currency}`
              : "—"
          }
        />
        <Metric label="Expenses" value={String(expenses.data?.length ?? 0)} />
        <Metric label="Loans" value={String(loans.data?.length ?? 0)} />
        <Metric label="Payslips" value={String(payslips.data?.length ?? 0)} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <form
          className="rounded-lg border border-sand bg-white/70 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(() =>
              createExpense.mutateAsync({
                expenseDate: expense.date,
                category: expense.category,
                description: expense.description,
                amount: expense.amount,
              }),
            );
          }}
        >
          <h2 className="font-semibold">Submit expense</h2>
          <div className="mt-3 grid gap-3">
            <Field
              label="Date"
              type="date"
              value={expense.date}
              onChange={(date) => setExpense({ ...expense, date })}
            />
            <Field
              label="Category"
              value={expense.category}
              onChange={(category) => setExpense({ ...expense, category })}
            />
            <Field
              label="Description"
              value={expense.description}
              onChange={(description) =>
                setExpense({ ...expense, description })
              }
            />
            <Field
              label="Amount (AED)"
              value={expense.amount}
              onChange={(amount) => setExpense({ ...expense, amount })}
            />
            <Button type="submit" disabled={createExpense.isPending}>
              Submit
            </Button>
          </div>
        </form>

        <form
          className="rounded-lg border border-sand bg-white/70 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(() =>
              createLoan.mutateAsync({
                purpose: loan.purpose,
                principalAmount: loan.principal,
                instalmentAmount: loan.instalment,
              }),
            );
          }}
        >
          <h2 className="font-semibold">Request employee loan</h2>
          <div className="mt-3 grid gap-3">
            <Field
              label="Purpose"
              value={loan.purpose}
              onChange={(purpose) => setLoan({ ...loan, purpose })}
            />
            <Field
              label="Amount (AED)"
              value={loan.principal}
              onChange={(principal) => setLoan({ ...loan, principal })}
            />
            <Field
              label="Monthly instalment (AED)"
              value={loan.instalment}
              onChange={(instalment) => setLoan({ ...loan, instalment })}
            />
            <Button type="submit" disabled={createLoan.isPending}>
              Request
            </Button>
          </div>
        </form>
      </section>

      {admin ? (
        <section className="rounded-lg border border-sand bg-white/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Payroll runs</h2>
            <Link className="text-sm underline" href="/payroll">
              Open run workflow →
            </Link>
          </div>
          <div className="mt-3 space-y-2 text-sm">
            {(runs.data ?? []).map((run) => (
              <div
                className="flex justify-between border-t border-sand/70 py-2"
                key={run.payrollRunId}
              >
                <span>
                  {run.periodStart} to {run.periodEnd}
                </span>
                <span>
                  {run.status} · {run.totalNet} {run.currency}
                </span>
              </div>
            ))}
            {!runs.data?.length ? (
              <p className="text-muted">No durable payroll run yet.</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-sand bg-white/70 p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold">{value}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="text-sm">
      {label}
      <input
        required
        type={type}
        className="mt-1 w-full rounded border border-sand bg-white px-3 py-2"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
