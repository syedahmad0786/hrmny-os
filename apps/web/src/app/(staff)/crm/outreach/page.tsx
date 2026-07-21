"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  CrmBtn,
  CrmEmpty,
  CrmPageHeader,
  CrmTag,
} from "@/components/crm/ui";

export default function CrmOutreachPage() {
  const utils = trpc.useUtils();
  const queue = trpc.outreach.queue.list.useQuery({ status: "pending" });
  const kill = trpc.outreach.killSwitch.get.useQuery();
  const approve = trpc.outreach.queue.approve.useMutation({
    onSuccess: () => void utils.outreach.invalidate(),
  });
  const reject = trpc.outreach.queue.reject.useMutation({
    onSuccess: () => void utils.outreach.invalidate(),
  });
  const setKill = trpc.outreach.killSwitch.set.useMutation({
    onSuccess: () => void utils.outreach.invalidate(),
  });
  const [last, setLast] = useState<unknown>(null);

  return (
    <main>
      <CrmPageHeader
        title="Outreach drafts"
        description="AI-assisted copy with a human approval gate before any Gmail action."
        actions={
          <CrmBtn
            onClick={() =>
              void setKill.mutateAsync({
                channel: "gmail",
                enabled: !kill.data?.gmail,
              })
            }
          >
            Toggle Gmail kill
          </CrmBtn>
        }
      />

      <section className="crm-split">
        <div className="crm-panel">
          <div className="crm-panel-head">
            <div>
              <h3>Human approval queue</h3>
              <p>No unattended auto-send</p>
            </div>
            <CrmTag kind={kill.data?.gmail ? "success" : "danger"}>
              {kill.data?.gmail ? "Kill switch armed" : "Gmail kill off"}
            </CrmTag>
          </div>
          <div className="crm-panel-body crm-approval-stack">
            {queue.isLoading ? (
              <CrmEmpty title="Loading drafts…" />
            ) : (queue.data ?? []).length === 0 ? (
              <CrmEmpty
                title="Queue empty"
                hint="Draft outreach from a deal to populate this approval list."
              />
            ) : (
              (queue.data ?? []).map((item) => (
                <article key={item.approvalId} className="crm-approval-mini">
                  <div className="flex items-center justify-between gap-2">
                    <CrmTag kind={item.channel === "gmail" ? "ochre" : "info"}>
                      {item.channel} draft
                    </CrmTag>
                    <span className="text-[10px] text-[var(--muted)]">
                      → {item.toEmail}
                    </span>
                  </div>
                  <h4>{item.subject}</h4>
                  <p style={{ whiteSpace: "pre-wrap" }}>{item.body}</p>
                  <div className="crm-approval-actions">
                    <CrmBtn
                      variant="primary"
                      onClick={async () => {
                        const r = await approve.mutateAsync({
                          id: item.approvalId,
                          idempotencyKey: `approve-${item.approvalId}`,
                        });
                        setLast(r);
                      }}
                    >
                      Approve draft
                    </CrmBtn>
                    <CrmBtn
                      onClick={async () => {
                        const r = await reject.mutateAsync({
                          id: item.approvalId,
                          reason: "Rejected from CRM outreach tab",
                        });
                        setLast(r);
                      }}
                    >
                      Reject
                    </CrmBtn>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>

        <aside className="crm-panel">
          <div className="crm-panel-head">
            <h3>Channel rules</h3>
          </div>
          <div className="crm-panel-body">
            <div className="crm-checklist">
              <div className="crm-check-row">
                Gmail <span><CrmTag kind="warn">Approval required</CrmTag></span>
              </div>
              <div className="crm-check-row">
                LinkedIn <span><CrmTag kind="info">Copy only</CrmTag></span>
              </div>
              <div className="crm-check-row">
                Auto-send <span><CrmTag kind="danger">Disabled</CrmTag></span>
              </div>
              <div className="crm-check-row">
                Partner kill switch{" "}
                <span>
                  <CrmTag kind={kill.data?.gmail ? "success" : "warn"}>
                    {kill.data?.gmail ? "Armed" : "Off"}
                  </CrmTag>
                </span>
              </div>
            </div>
            <div className="crm-note">
              LinkedIn has no OAuth automation in V1. Approved copy is manually
              pasted by staff.
            </div>
            {last ? (
              <pre className="mt-3 overflow-auto text-[10px]">
                {JSON.stringify(last, null, 2)}
              </pre>
            ) : null}
          </div>
        </aside>
      </section>
    </main>
  );
}
