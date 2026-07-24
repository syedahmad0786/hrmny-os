import { describe, expect, it } from "vitest";
import {
  asanaWebhookSignature,
  validAsanaWebhookSignature,
} from "./asana-webhooks";

describe("Asana webhooks", () => {
  it("verifies the exact raw payload with a constant-time HMAC comparison", () => {
    const signature = asanaWebhookSignature(
      "shared-secret",
      '{"events":[{"action":"changed"}]}',
    );
    expect(
      validAsanaWebhookSignature(
        "shared-secret",
        '{"events":[{"action":"changed"}]}',
        signature,
      ),
    ).toBe(true);
    expect(
      validAsanaWebhookSignature(
        "shared-secret",
        '{"events":[{"action":"deleted"}]}',
        signature,
      ),
    ).toBe(false);
    expect(
      validAsanaWebhookSignature(
        "shared-secret",
        '{"events":[{"action":"changed"}]}',
        `${signature}00`,
      ),
    ).toBe(false);
  });
});
