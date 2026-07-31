"use client";

import { Button } from "@hrmny/ui";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

export default function RolesPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const permissions = trpc.admin.permissions.list.useQuery(undefined, {
    retry: false,
  });
  const roles = trpc.admin.roles.list.useQuery(undefined, { retry: false });
  const assignments = trpc.admin.roles.assignments.useQuery(undefined, {
    retry: false,
  });
  const [employeeId, setEmployeeId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      utils.admin.roles.list.invalidate(),
      utils.admin.roles.assignments.invalidate(),
      utils.admin.permissions.list.invalidate(),
    ]);
  const assign = trpc.admin.roles.assignEmployee.useMutation({
    onSuccess: async () => {
      setMessage("Role assigned and audited.");
      setReason("");
      await refresh();
    },
    onError: (error) => setMessage(error.message),
  });
  const revoke = trpc.admin.roles.revokeEmployee.useMutation({
    onSuccess: async () => {
      setMessage("Role revoked and audited.");
      setReason("");
      await refresh();
    },
    onError: (error) => setMessage(error.message),
  });

  const loading = roles.isLoading || assignments.isLoading;
  const error = roles.error ?? assignments.error ?? permissions.error;
  const canManage = Boolean(session.data?.canManageRoles);

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">
          Roles &amp; access
        </h1>
        <p className="mt-1 text-muted">
          Production role assignments and migration-controlled permissions.
          Margin remains hidden from Account Managers and portal users.
        </p>
      </div>

      <section className="rounded-xl border border-sand bg-white/70 p-4">
        <h2 className="font-medium">Your access</h2>
        {session.isLoading ? (
          <p className="mt-2 text-sm text-muted">Loading session…</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            {(session.data?.roles ?? []).map((item) => (
              <span key={item} className="rounded-full bg-sand px-3 py-1">
                {item}
              </span>
            ))}
            <span className="rounded-full border border-sand px-3 py-1">
              Margin {session.data?.canViewMargin ? "visible" : "restricted"}
            </span>
          </div>
        )}
      </section>

      {error ? (
        <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p>{error.message}</p>
          <Button
            type="button"
            variant="ghost"
            className="mt-2"
            onClick={() => void refresh()}
          >
            Retry
          </Button>
        </section>
      ) : loading ? (
        <p className="text-sm text-muted">Loading roles and assignments…</p>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(roles.data ?? []).map((item) => {
              const policies = permissions.data?.policies.filter(
                (policy) => policy.role === item.key,
              );
              return (
                <article
                  key={item.key}
                  className="rounded-xl border border-sand bg-white/70 p-4"
                >
                  <h2 className="font-display text-lg">{item.displayName}</h2>
                  <p className="text-xs text-muted">{item.key}</p>
                  <ul className="mt-3 space-y-1 text-sm">
                    {policies?.length ? (
                      policies.map((policy) => (
                        <li key={`${policy.resource}:${policy.action}`}>
                          <span
                            className={
                              policy.effect === "deny"
                                ? "text-red-700"
                                : "text-emerald-800"
                            }
                          >
                            {policy.effect === "deny" ? "Denied" : "Allowed"}
                          </span>{" "}
                          · {policy.resource}:{policy.action}
                        </li>
                      ))
                    ) : (
                      <li className="text-muted">No explicit policy rows.</li>
                    )}
                  </ul>
                </article>
              );
            })}
          </section>

          <section className="overflow-x-auto rounded-xl border border-sand bg-white/70 p-4">
            <h2 className="font-display text-xl">Employee assignments</h2>
            {!assignments.data?.length ? (
              <p className="mt-3 text-sm text-muted">No employees found.</p>
            ) : (
              <table className="mt-3 w-full min-w-[42rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-sand text-xs uppercase tracking-wide text-muted">
                    <th className="px-2 py-2">Employee</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Roles</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.data.map((person) => (
                    <tr
                      key={person.employeeId}
                      className="border-b border-sand/70"
                    >
                      <td className="px-2 py-3">
                        <p className="font-medium">{person.displayName}</p>
                        <p className="text-xs text-muted">{person.email}</p>
                      </td>
                      <td className="px-2 py-3">
                        {person.isActive ? "Active" : "Inactive"}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex flex-wrap gap-2">
                          {person.roles.length ? (
                            person.roles.map((membership) => (
                              <span
                                key={membership.roleId}
                                className="inline-flex items-center gap-1 rounded-full bg-sand px-2 py-1"
                              >
                                {membership.key}
                                {canManage ? (
                                  <button
                                    type="button"
                                    aria-label={`Revoke ${membership.key} from ${person.displayName}`}
                                    className="font-bold"
                                    disabled={
                                      revoke.isPending ||
                                      reason.trim().length < 5
                                    }
                                    onClick={() =>
                                      revoke.mutate({
                                        employeeId: person.employeeId,
                                        roleId: membership.roleId,
                                        reason,
                                      })
                                    }
                                  >
                                    ×
                                  </button>
                                ) : null}
                              </span>
                            ))
                          ) : (
                            <span className="text-muted">No role assigned</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {canManage ? (
        <section className="rounded-xl border border-sand bg-white/70 p-4">
          <h2 className="font-display text-xl">Manage assignments</h2>
          <p className="mt-1 text-sm text-muted">
            A reason is required. The final active Partner cannot be removed.
          </p>
          <form
            className="mt-4 grid gap-3 md:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              assign.mutate({ employeeId, roleId, reason });
            }}
          >
            <label className="text-sm">
              Employee
              <select
                className="mt-1 w-full rounded border border-sand bg-white px-3 py-2"
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
              >
                <option value="">Select employee</option>
                {(assignments.data ?? [])
                  .filter((person) => person.isActive)
                  .map((person) => (
                    <option key={person.employeeId} value={person.employeeId}>
                      {person.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm">
              Role
              <select
                className="mt-1 w-full rounded border border-sand bg-white px-3 py-2"
                value={roleId}
                onChange={(event) => setRoleId(event.target.value)}
              >
                <option value="">Select role</option>
                {(roles.data ?? []).flatMap((item) =>
                  item.roleId ? (
                    <option key={item.roleId} value={item.roleId}>
                      {item.displayName}
                    </option>
                  ) : (
                    []
                  ),
                )}
              </select>
            </label>
            <label className="text-sm">
              Audit reason
              <input
                className="mt-1 w-full rounded border border-sand bg-white px-3 py-2"
                value={reason}
                minLength={5}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <Button
              type="submit"
              disabled={
                !employeeId ||
                !roleId ||
                reason.trim().length < 5 ||
                assign.isPending
              }
            >
              {assign.isPending ? "Assigning…" : "Assign role"}
            </Button>
          </form>
          {message ? (
            <p className="mt-3 text-sm" role="status">
              {message}
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
