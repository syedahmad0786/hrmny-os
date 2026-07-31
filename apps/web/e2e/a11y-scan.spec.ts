import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const pages = [
  "/",
  "/login",
  "/roles",
  "/work",
  "/admin/audit",
  "/admin/features",
  "/settings/connections",
  "/conventions",
  "/portal",
] as const;
const artifacts = path.join(process.cwd(), "test-results", "artifacts");

test.describe("accessibility smoke (axe)", () => {
  test("scan primary surfaces and write report", async ({ page }) => {
    test.setTimeout(180_000);
    const report: Array<{
      url: string;
      violations: Array<{
        id: string;
        impact: string | null | undefined;
        description: string;
        nodes: number;
        targets: string[];
      }>;
    }> = [];

    for (const route of pages) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      // Staff shell may need a moment for tRPC session.
      await page.waitForTimeout(1500);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      report.push({
        url: route,
        violations: results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          nodes: v.nodes.length,
          targets: v.nodes.flatMap((node) => node.target.map(String)),
        })),
      });
    }

    const outPath = path.join(artifacts, "a11y-axe-report.json");
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(
      outPath,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), report },
        null,
        2,
      ),
    );

    const blockers = report.flatMap((r) =>
      r.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      ),
    );
    expect(
      blockers,
      `Critical/serious a11y issues:\n${JSON.stringify(blockers, null, 2)}`,
    ).toEqual([]);
  });
});
