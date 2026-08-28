import { describe, expect, it } from "vitest";
import { parseBayzatCsv } from "./csv";
import { createBayzatAdapter } from "./index";

const SAMPLE = `external_id,display_name,email,department,basic_salary,leave_balance
bz-001,Amina Khalil,amina@hrmny.local,Finance,12000,14
bz-002,Omar Said,omar@hrmny.local,Creative,15000,10
`;

describe("Bayzat CSV parse", () => {
  it("parses employee rows with flexible headers", () => {
    const rows = parseBayzatCsv(SAMPLE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      externalId: "bz-001",
      displayName: "Amina Khalil",
      email: "amina@hrmny.local",
      department: "Finance",
      basicSalaryAed: "12000",
    });
  });

  it("importCsv upserts into mirror without writing Bayzat SoR", async () => {
    const bayzat = createBayzatAdapter({ source: "csv" });
    const imported = await bayzat.importCsv(SAMPLE);
    expect(imported).toHaveLength(2);
    const listed = await bayzat.listEmployees();
    expect(listed).toHaveLength(2);
    await bayzat.importCsv(
      `id,name,email\nbz-001,Amina Updated,amina@hrmny.local\n`,
    );
    const after = await bayzat.listEmployees();
    expect(after).toHaveLength(2);
    expect(after.find((r) => r.externalId === "bz-001")?.displayName).toBe(
      "Amina Updated",
    );
  });

  it("fails loud when an unverified Bayzat API mode is requested", () => {
    expect(() =>
      createBayzatAdapter({ source: "api", apiKey: "test-key" }),
    ).toThrow(/no official employee-list API contract/i);
  });
});
