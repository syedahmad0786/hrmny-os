import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";

const url = "https://hrmny-os.vercel.app/api/integrations/google-chat/events";

describe("Google Chat events route", () => {
  it("publishes the exact endpoint without secrets", async () => {
    const response = await GET(new Request(url));
    await expect(response.json()).resolves.toEqual({
      ok: true,
      endpoint: url,
      authentication: "Google-signed OIDC bearer token",
    });
  });

  it("rejects unsigned events before parsing their body", async () => {
    const response = await POST(
      new Request(url, { method: "POST", body: "not-json" }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });
});
