"use client";

import { useState } from "react";
import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";

export default function TimePage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const policies = trpc.hrOperations.policies.list.useQuery();
  const requests = trpc.hrOperations.requests.list.useQuery();
  const records = trpc.hrOperations.attendance.list.useQuery();
  const corrections = trpc.hrOperations.attendance.corrections.list.useQuery();
  const createRequest = trpc.hrOperations.requests.create.useMutation({
    onSuccess: () => void utils.hrOperations.requests.invalidate(),
  });
  const decideRequest = trpc.hrOperations.requests.decide.useMutation({
    onSuccess: () => void utils.hrOperations.requests.invalidate(),
  });
  const clockIn = trpc.hrOperations.attendance.clockIn.useMutation({
    onSuccess: () => void utils.hrOperations.attendance.invalidate(),
  });
  const clockOut = trpc.hrOperations.attendance.clockOut.useMutation({
    onSuccess: () => void utils.hrOperations.attendance.invalidate(),
  });
  const createCorrection =
    trpc.hrOperations.attendance.corrections.create.useMutation({
      onSuccess: () => void utils.hrOperations.attendance.invalidate(),
    });
  const decideCorrection =
    trpc.hrOperations.attendance.corrections.decide.useMutation({
      onSuccess: () => void utils.hrOperations.attendance.invalidate(),
    });
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [reason, setReason] = useState("");
  const [correctionDate, setCorrectionDate] = useState("");
  const [correctionIn, setCorrectionIn] = useState("");
  const [correctionOut, setCorrectionOut] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [message, setMessage] = useState("");

  const mutate = async (work: () => Promise<unknown>) => {
    try {
      await work();
      setMessage("Saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save");
    }
  };

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">
          Leave & attendance
        </h1>
        <p className="mt-1 text-sm text-muted">
          Request leave, clock your workday, and submit attendance corrections.
        </p>
      </div>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <h2 className="font-semibold">Today</h2>
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            onClick={() => void mutate(() => clockIn.mutateAsync())}
          >
            Clock in
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void mutate(() => clockOut.mutateAsync())}
          >
            Clock out
          </Button>
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          {(records.data ?? []).slice(0, 10).map((record) => (
            <li key={record.attendanceRecordId}>
              {record.employeeName} · {record.workDate} ·{" "}
              {new Date(record.clockInAt).toLocaleTimeString()} –{" "}
              {record.clockOutAt
                ? new Date(record.clockOutAt).toLocaleTimeString()
                : "still working"}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <h2 className="font-semibold">New leave request</h2>
        <form
          className="mt-3 grid gap-3 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(() =>
              createRequest.mutateAsync({
                leavePolicyId: policyId,
                startDate,
                endDate,
                reason: reason || undefined,
                portion: "full",
              }),
            );
          }}
        >
          <label className="text-sm">
            Leave type
            <select
              required
              className="mt-1 w-full rounded border border-sand bg-white px-3 py-2"
              value={policyId}
              onChange={(event) => setPolicyId(event.target.value)}
            >
              <option value="">Choose…</option>
              {(policies.data ?? [])
                .filter((policy) => policy.isActive)
                .map((policy) => (
                  <option
                    key={policy.leavePolicyId}
                    value={policy.leavePolicyId}
                  >
                    {policy.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm">
            Reason
            <input
              className="mt-1 w-full rounded border border-sand bg-white px-3 py-2"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label className="text-sm">
            From
            <input
              required
              type="date"
              className="mt-1 w-full rounded border border-sand bg-white px-3 py-2"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label className="text-sm">
            To
            <input
              required
              type="date"
              className="mt-1 w-full rounded border border-sand bg-white px-3 py-2"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={createRequest.isPending}>
            Submit leave request
          </Button>
        </form>
      </section>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <h2 className="font-semibold">Requests</h2>
        <ul className="mt-3 space-y-3 text-sm">
          {(requests.data ?? []).map((request) => (
            <li
              key={request.leaveRequestId}
              className="border-t border-sand/60 pt-3"
            >
              <p>
                {request.employeeName} · {request.policyName} ·{" "}
                {request.startDate} to {request.endDate} · {request.days} day(s)
                · {request.status}
              </p>
              {request.status === "pending" &&
              request.employeeId !== session.data?.employeeId ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    onClick={() =>
                      void mutate(() =>
                        decideRequest.mutateAsync({
                          id: request.leaveRequestId,
                          decision: "approved",
                        }),
                      )
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      void mutate(() =>
                        decideRequest.mutateAsync({
                          id: request.leaveRequestId,
                          decision: "rejected",
                        }),
                      )
                    }
                  >
                    Reject
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <h2 className="font-semibold">Attendance correction</h2>
        <form
          className="mt-3 grid gap-3 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(() =>
              createCorrection.mutateAsync({
                workDate: correctionDate,
                clockInAt: new Date(correctionIn).toISOString(),
                clockOutAt: new Date(correctionOut).toISOString(),
                reason: correctionReason,
              }),
            );
          }}
        >
          <label className="text-sm">
            Work date
            <input
              required
              type="date"
              className="mt-1 w-full rounded border border-sand bg-white px-3 py-2"
              value={correctionDate}
              onChange={(event) => setCorrectionDate(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Reason
            <input
              required
              className="mt-1 w-full rounded border border-sand bg-white px-3 py-2"
              value={correctionReason}
              onChange={(event) => setCorrectionReason(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Correct clock-in
            <input
              required
              type="datetime-local"
              className="mt-1 w-full rounded border border-sand bg-white px-3 py-2"
              value={correctionIn}
              onChange={(event) => setCorrectionIn(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Correct clock-out
            <input
              required
              type="datetime-local"
              className="mt-1 w-full rounded border border-sand bg-white px-3 py-2"
              value={correctionOut}
              onChange={(event) => setCorrectionOut(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={createCorrection.isPending}>
            Submit correction
          </Button>
        </form>
        <ul className="mt-4 space-y-3 text-sm">
          {(corrections.data ?? []).map((request) => (
            <li
              key={request.attendanceCorrectionRequestId}
              className="border-t border-sand/60 pt-3"
            >
              {request.employeeName} · {request.workDate} · {request.status}
              {request.status === "pending" &&
              request.employeeId !== session.data?.employeeId ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    onClick={() =>
                      void mutate(() =>
                        decideCorrection.mutateAsync({
                          id: request.attendanceCorrectionRequestId,
                          decision: "approved",
                        }),
                      )
                    }
                  >
                    Approve correction
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      void mutate(() =>
                        decideCorrection.mutateAsync({
                          id: request.attendanceCorrectionRequestId,
                          decision: "rejected",
                        }),
                      )
                    }
                  >
                    Reject
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {message ? (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      ) : null}
    </main>
  );
}
