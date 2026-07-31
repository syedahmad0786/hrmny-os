import { test, expect } from "@playwright/test";

/**
 * M1 demo script smoke (MASTER §12.1) — partner persona via x-dev-role header.
 */
test.describe.serial("M1 substrate demo", () => {
  test.setTimeout(120_000);

  test("M1 production surfaces load", async ({ page }) => {
    const goto = (path: string) =>
      page.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });

    await goto("/roles");
    await expect(
      page.getByRole("heading", { name: /Roles & access/i }),
    ).toBeVisible();

    await goto("/settings/connections");
    await expect(page.locator("body")).toContainText(/current provider state/i);
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();

    const toolSearch = page.getByPlaceholder("Search tools");
    await toolSearch.fill("__no_such_tool__");
    await expect(toolSearch).toHaveValue("__no_such_tool__");
    await expect(
      page
        .getByText("No managed tools match that search.")
        .or(page.getByRole("button", { name: "Retry" })),
    ).toBeVisible();
    await toolSearch.fill("");

    await goto("/conventions");
    await expect(
      page.getByRole("heading", { name: /Conventions/i }),
    ).toBeVisible();

    await goto("/admin/audit");
    await expect(
      page.getByRole("heading", { name: /Audit log/i }),
    ).toBeVisible();

    await goto("/admin/features");
    await expect(
      page.getByRole("heading", { name: /Shape each client's portal/i }),
    ).toBeVisible();
    const featureSearch = page.getByPlaceholder("Search features");
    await featureSearch.fill("__no_such_feature__");
    await expect(page.getByText("No features match these filters.")).toBeVisible();
    await featureSearch.fill("");

    await page.getByRole("button", { name: "role", exact: true }).click();
    await expect(page.getByLabel("Applies to")).toBeEnabled();
    await page.getByRole("button", { name: "global", exact: true }).click();

    const switches = page.getByRole("switch");
    const switchCount = await switches.count();
    let switchIndex = -1;
    for (let index = 0; index < switchCount; index += 1) {
      if (await switches.nth(index).isEnabled()) {
        switchIndex = index;
        break;
      }
    }
    expect(switchIndex).toBeGreaterThanOrEqual(0);
    const featureSwitch = switches.nth(switchIndex);
    const featureRow = featureSwitch.locator("../..");
    const before = await featureSwitch.getAttribute("aria-checked");
    await featureSwitch.click();
    await expect(featureSwitch).toHaveAttribute(
      "aria-checked",
      before === "true" ? "false" : "true",
    );
    await featureRow.getByRole("button", { name: "Inherit" }).click();
  });

  test("Work Files creates, versions and QCs an asset", async ({ page }) => {
    await page.goto("/work", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page
      .getByText("Confirm Asana workspace connection", { exact: true })
      .click();
    await expect(page.getByText("Versioned creative assets")).toBeVisible();

    const title = `M1 proof ${Date.now()}`;
    await page.getByPlaceholder("Asset title").fill(title);
    await page.getByRole("button", { name: "Create asset" }).click();
    const card = page.locator("article").filter({ hasText: title });
    await expect(card).toContainText("0 versions");

    const upload = card.locator('input[type="file"]');
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    await upload.setInputFiles({
      name: "m1-proof-v1.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(card).toContainText("1 version");
    await upload.setInputFiles({
      name: "m1-proof-v2.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(card).toContainText("2 versions");

    await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes("assets.signedUrl"),
      ),
      card.getByRole("button", { name: "Open v2" }).click(),
    ]);
    const qcNotes = card.getByLabel(`QC notes for ${title}`);
    await qcNotes.fill("M1 browser control proof");
    await card.getByRole("button", { name: "Fail" }).click();
    await expect(card).toContainText("qc_failed");
    await card.getByRole("button", { name: "Waive" }).click();
    await expect(card).toContainText("qc_waived");
    await card.getByRole("button", { name: "Pass QC" }).click();
    await expect(card).toContainText("qc_passed");

    await page.goto("/admin/audit", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText("assets.qc");
    await expect(page.locator("body")).toContainText("assets.signedUrl");

    await page.goto("/settings/connections", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("body")).toContainText("dam_upload");
  });

  test("role and convention controls mutate, audit and restore", async ({
    page,
  }) => {
    await page.goto("/roles", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Employee").selectOption({ label: "Dev AM" });
    await page.getByLabel("Role").selectOption({ label: "Director" });
    const reason = page.getByLabel("Audit reason");
    await reason.fill("M1 browser role assignment proof");
    await page.getByRole("button", { name: "Assign role" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Role assigned and audited.",
    );

    const amRow = page.getByRole("row").filter({ hasText: "Dev AM" });
    await expect(amRow).toContainText("director");
    await reason.fill("M1 browser role revocation proof");
    await amRow
      .getByRole("button", { name: "Revoke director from Dev AM" })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      "Role revoked and audited.",
    );
    await expect(amRow).not.toContainText("director");

    await page.goto("/conventions", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Edit" }).first().click();
    const editor = page.locator("textarea").first();
    const original = await editor.inputValue();
    await editor.fill("{");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator('[aria-live="polite"]')).toBeVisible();
    await editor.fill(original);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(editor).toBeHidden();

    await page.goto("/admin/audit", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Action contains").fill("admin.roles");
    await page.getByLabel("Entity type").fill("employee");
    await expect(page.locator("body")).toContainText(
      "admin.roles.assignEmployee",
    );
    await expect(page.locator("body")).toContainText(
      "admin.roles.revokeEmployee",
    );
  });
});
