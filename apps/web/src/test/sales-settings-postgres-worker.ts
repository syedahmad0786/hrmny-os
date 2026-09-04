export {};

function finish(code: number, payload: Record<string, unknown>) {
  const stream = code === 0 ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(payload)}\n`, () => process.exit(code));
}

async function main() {
  const encoded = process.argv[2];
  if (!encoded) throw new Error("SETTINGS_WORKER_INPUT_REQUIRED");
  const input = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as {
    field: "emailPerDay" | "companiesPerResearchRun";
    value: number;
    delayMs: number;
  };
  const { mutateSalesOsSettings } = await import("../server/sales-os/store");
  const result = await mutateSalesOsSettings(async (settings) => {
    await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    const next = {
      ...settings,
      caps: { ...settings.caps, [input.field]: input.value },
    };
    return { settings: next, result: next.caps };
  });
  finish(0, result);
}

void main().catch((error: unknown) => {
  finish(1, {
    error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
  });
});
