import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../migrations/0084_composio_managed_multi_account.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("0084 managed Composio multi-account migration", () => {
  it("exempts only staff Composio rows and keeps remote ids owner-unique", () => {
    expect(migration).toContain(
      "toolkit LIKE 'composio:%' AND scope = 'staff'",
    );
    expect(migration).toContain("connection_account_composio_remote_uniq");
    expect(migration).toContain("lower(btrim(external_connection_id))");
    expect(migration).toContain("COMPOSIO_REMOTE_BINDING_DUPLICATE");
    expect(migration).not.toMatch(
      /DELETE FROM|UPDATE public\.connection_account/i,
    );
  });
});
