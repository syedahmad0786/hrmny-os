import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/server/db";
import { dispatchPendingDiscoveryJobs } from "@/server/inngest/discovery";
import { continuePendingDiscoveryInterpretationJobs } from "@/server/sales-os/discovery-callback-ingest";
import { reconcileDiscoveryRuns } from "@/server/sales-os/discovery-runs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Recovery only. This endpoint never collects sources or runs another module. */
export async function GET(request: Request) {
  const secret = process.env.DISCOVERY_REPAIR_SECRET?.trim();
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || received.length !== expected.length || !timingSafeEqual(received, expected))
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (!getDb())
    return Response.json({ ok: false, code: "DATABASE_UNAVAILABLE" }, { status: 503 });
  try {
    const reconciliation = await reconcileDiscoveryRuns();
    const dispatch = await dispatchPendingDiscoveryJobs();
    const interpretation = await continuePendingDiscoveryInterpretationJobs();
    return Response.json({ ok: true, reconciliation, dispatch, interpretation });
  } catch {
    return Response.json({ ok: false, code: "DISCOVERY_REPAIR_FAILED" }, { status: 503 });
  }
}
