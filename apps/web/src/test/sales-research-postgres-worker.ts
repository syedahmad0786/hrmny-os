type WorkerInput =
  | {
      action: "propose";
      payload: {
        requestId: string;
        name: string;
        website: string;
        evidence: string;
      };
    }
  | { action: "approve"; proposalId: string };

function finish(code: number, payload: Record<string, unknown>) {
  const stream = code === 0 ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(payload)}\n`, () => process.exit(code));
}

async function main() {
  Object.assign(process.env, {
    DATABASE_MODE: "postgres",
    HRMNY_DATABASE_SSL_MODE: "disable",
    LLM_PROVIDER: "mock",
    APOLLO_MODE: "mock",
    APOLLO_ALLOW_PAID_OPERATIONS: "false",
    XERO_MODE: "mock",
    XERO_WRITE_ENABLED: "false",
  });
  globalThis.fetch = async () => {
    throw new Error("CI_POSTGRES_WORKER_NETWORK_FORBIDDEN");
  };

  const encoded = process.argv[2];
  if (!encoded) throw new Error("POSTGRES_WORKER_INPUT_REQUIRED");
  const input = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as WorkerInput;

  if (input.action === "propose") {
    const { ingestManualResearch } =
      await import("../server/sales-os/research");
    const receipt = await ingestManualResearch({
      ...input.payload,
      actorEmployeeId: null,
      sector: "Retail",
      whyThis: "Disposable PostgreSQL proof for a synthetic UAE launch signal.",
      leadSourceLane: "ci_postgres",
      employeesGlobal: 600,
    });
    finish(0, {
      proposalId: receipt.proposal.id,
      receiptId: receipt.receiptId,
      signalId: receipt.signalId,
      auditId: receipt.auditId,
      replayed: receipt.replayed,
    });
    return;
  }

  const { decideCompany } = await import("../server/sales-os/gates");
  const approved = await decideCompany(input.proposalId, "approve", {
    actorId: null,
  });
  finish(0, {
    proposalId: approved.id,
    companyId: approved.companyId,
    approvalState: approved.approvalState,
  });
}

void main().catch((error: unknown) => {
  finish(1, {
    error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
  });
});
