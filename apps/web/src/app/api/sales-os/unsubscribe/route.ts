import { NextResponse } from "next/server";
import { honorUnsubscribe } from "@/server/sales-os/replies";
import { verifyUnsubscribeToken } from "@/server/sales-os/compliance";
import {
  completeIntegrationReceipt,
  failIntegrationReceipt,
  recordIntegrationReceipt,
  transitionIntegrationReceiptProgress,
} from "@/server/integrations/inbox";

export const dynamic = "force-dynamic";

/** One-click unsubscribe authenticated by the recipient-bound footer token. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const email = verifyUnsubscribeToken(token);
  if (!email) {
    return NextResponse.json(
      { ok: false, error: "invalid or expired unsubscribe link" },
      { status: 400 },
    );
  }
  const receipt = await recordIntegrationReceipt({
    provider: "hrmny",
    externalEventId: `unsubscribe:${token.slice(-43)}`,
    operation: "sales.unsubscribe",
    rawBody: token,
    status: "processing",
    payload: { email },
  });
  let claimed = !receipt.duplicate;
  if (receipt.duplicate && receipt.status === "failed") {
    claimed = await transitionIntegrationReceiptProgress(
      receipt.receiptId,
      { status: "failed", stateVersion: receipt.stateVersion },
      { status: "processing", result: { state: "processing" } },
    );
  }
  if (!claimed && receipt.status !== "completed") {
    return NextResponse.json(
      { ok: false, error: "unsubscribe processing; retry shortly" },
      { status: 503 },
    );
  }
  if (claimed) {
    try {
      const result = await honorUnsubscribe({ email, source: "one-click" });
      await completeIntegrationReceipt(receipt.receiptId, result);
    } catch (error) {
      await failIntegrationReceipt(
        receipt.receiptId,
        error instanceof Error ? error.message : "Unsubscribe failed",
      ).catch(() => undefined);
      return NextResponse.json(
        { ok: false, error: "unsubscribe could not be recorded; retry" },
        { status: 503 },
      );
    }
  }
  return new NextResponse(
    `<!doctype html><html><body style="font-family:sans-serif;padding:2rem">
      <h1>You are unsubscribed</h1>
      <p>This address will not receive further hrmny outreach.</p>
    </body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function POST(request: Request) {
  return GET(request);
}
