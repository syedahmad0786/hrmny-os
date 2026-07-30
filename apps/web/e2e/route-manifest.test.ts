import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTES } from "./route-manifest";

/**
 * Local gate: the manifest must list exactly the set of page routes that exist
 * under src/app. Fails when someone adds (or removes) a page.tsx without
 * updating route-manifest.ts — which would leave that route un-crawled.
 *
 * This is the runnable check on this machine; the Playwright crawler itself runs
 * in CI (browser e2e cannot execute locally here — loopback swallows chunked
 * responses).
 */

const appDir = fileURLToPath(new URL("../src/app", import.meta.url));

function walkPages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkPages(full));
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

/** apps/web/src/app/(staff)/crm/deals/[id]/page.tsx → /crm/deals/[id] */
function fileToRoute(absFile: string): string {
  const rel = path.relative(appDir, absFile).split(path.sep).join("/");
  const segs = rel
    .replace(/\/page\.tsx$/, "")
    .replace(/^page\.tsx$/, "")
    .split("/")
    .filter((s) => s && !/^\(.+\)$/.test(s)); // drop route groups like (staff)
  return "/" + segs.join("/");
}

describe("route manifest coverage", () => {
  const discovered = new Set(walkPages(appDir).map(fileToRoute));
  const manifest = new Set(ROUTES.map((r) => r.route));

  it("has an entry for every page.tsx under src/app", () => {
    const missing = [...discovered].filter((r) => !manifest.has(r)).sort();
    expect(missing, `pages missing from route-manifest.ts:\n${missing.join("\n")}`).toEqual([]);
  });

  it("has no stale entries pointing at pages that no longer exist", () => {
    const stale = [...manifest].filter((r) => !discovered.has(r)).sort();
    expect(stale, `manifest routes with no page.tsx:\n${stale.join("\n")}`).toEqual([]);
  });

  it("every dynamic route has a concrete sample distinct from its pattern", () => {
    for (const r of ROUTES) {
      if (r.route.includes("[")) {
        expect(r.sample, `${r.route} needs a concrete sample`).not.toContain("[");
      }
    }
  });
});
