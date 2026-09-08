import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { authorizedRequest, projectResult } from "./access.mjs";
const employeeId = "c0000000-0000-4000-8000-000000000001";
const a = "hrmny-project-c0000000-0000-4000-8000-000000000002",
  b = "hrmny-project-c0000000-0000-4000-8000-000000000003";
const secret = "synthetic-test-key-".repeat(3),
  now = 1000000;
const request = {
  version: 1,
  audience: "hrmny-brain",
  requestId: employeeId,
  employeeId,
  expiresAt: now + 15000,
  sources: [a],
  operation: "search",
  args: { query: "launch", limit: 5, snippet_chars: 1200 },
};
function signed(overrides = {}) {
  const body = JSON.stringify({ ...request, ...overrides });
  return [
    body,
    createHmac("sha256", secret).update(body).digest("hex"),
    secret,
    now,
  ];
}
test("signature, expiry, actor, operation and source arguments fail closed", () => {
  assert.equal(authorizedRequest(...signed()).operation, "search");
  const clockSkew = signed();
  clockSkew[3] = now - 5000;
  assert.equal(authorizedRequest(...clockSkew).operation, "search");
  const forged = signed();
  forged[0] = forged[0].replace("launch", "leak");
  assert.throws(() => authorizedRequest(...forged));
  for (const override of [
    { audience: "other" },
    { expiresAt: now },
    { expiresAt: now + 20001 },
    { operation: "put_page" },
    { operation: "sources_list" },
    { sources: [] },
    { sources: ["__all__"] },
    { sources: [`hrmny-personal-c0000000-0000-4000-8000-000000000009`] },
    { args: { ...request.args, source_id: b } },
  ])
    assert.throws(() => authorizedRequest(...signed(override)));
});
test("pages and both graph endpoints remain in the authorized source grant", () => {
  const pages = [
    { source_id: a, slug: "launch", chunk_text: "Allowed" },
    { source_id: b, slug: "secret", chunk_text: "Hidden" },
    { slug: "unscoped", chunk_text: "Hidden" },
  ];
  assert.deepEqual(
    projectResult("search", pages, [a]).map((p) => p.slug),
    ["launch"],
  );
  const edges = [
    {
      from_source_id: a,
      to_source_id: a,
      from_slug: "launch",
      to_slug: "brief",
      link_type: "depends_on",
    },
    {
      from_source_id: a,
      to_source_id: b,
      from_slug: "launch",
      to_slug: "secret",
    },
    {
      from_source_id: a,
      to_source_id: a,
      origin_source_id: b,
      from_slug: "launch",
      to_slug: "brief",
    },
  ];
  assert.equal(projectResult("get_links", edges, [a]).length, 1);
  assert.equal(
    JSON.stringify(projectResult("get_links", edges, [a])).includes("secret"),
    false,
  );
});
