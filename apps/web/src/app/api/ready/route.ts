import { sql } from "@hrmny/db";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";

/** Lightweight deploy smoke — no secrets, no business data. */
export async function GET() {
  const db = getDb();
  let database: "up" | "down" = "down";
  if (db) {
    try {
      await db.execute(sql`select 1`);
      database = "up";
    } catch {
      database = "down";
    }
  }
  const body = {
    ok: database === "up",
    authMode: process.env.AUTH_MODE ?? "dev",
    llmProvider: process.env.LLM_PROVIDER ?? "mock",
    xeroWriteEnabled: process.env.XERO_WRITE_ENABLED === "true",
    database,
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}
