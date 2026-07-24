import { describe, expect, it, vi } from "vitest";
import {
  buildWorkFormReceipt,
  sendWorkFormReceipt,
} from "./work-form-receipts";

describe("work form email receipts", () => {
  it("sends a bounded plain-text receipt without attachment bodies", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const raw = JSON.parse(String(init?.body)).raw as string;
      const message = Buffer.from(raw, "base64url").toString("utf8");
      expect(message).toContain("To: submitter@example.com");
      expect(message).toContain("Message-ID: <hrmny-form-");
      expect(message).toContain("Attachments: brief.pdf");
      expect(message).not.toContain("secret-base64");
      return new Response(JSON.stringify({ id: "gmail-message-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const text = buildWorkFormReceipt({
      formName: "Design request",
      confirmationMessage: "We received your request.",
      questions: [
        { key: "email", label: "Email", type: "email" },
        { key: "attachments", label: "Attachments", type: "attachment" },
      ],
      answers: {
        email: "submitter@example.com",
        attachments: [
          { fileName: "brief.pdf", contentBase64: "secret-base64" },
        ],
      },
    });

    await expect(
      sendWorkFormReceipt({
        accessToken: "token",
        recipient: "submitter@example.com",
        subject: "Design request received\r\nBcc: attacker@example.com",
        text,
        submissionId: "00000000-0000-4000-8000-000000000123",
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).resolves.toEqual({ id: "gmail-message-1" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
