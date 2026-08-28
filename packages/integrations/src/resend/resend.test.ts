import { describe, expect, it } from "vitest";
import {
  createResendAdapter,
  createResendLive,
  createResendMock,
} from "./index";

describe("resend email adapter", () => {
  it("mock records every send and returns a synthetic id", async () => {
    const r = createResendMock();
    expect(r.mode).toBe("mock");

    const res = await r.send({
      to: ["a@example.com"],
      subject: "Hello",
      markdown: "# Hello",
      idempotencyKey: "report/example/1",
    });
    expect(res.mode).toBe("mock");
    expect(res.id).toBeTruthy();
    expect(res.to).toEqual(["a@example.com"]);
    expect(r.recorded()).toHaveLength(1);

    await r.send({
      to: ["b@example.com"],
      subject: "Two",
      markdown: "x",
      idempotencyKey: "report/example/2",
    });
    expect(r.recorded()).toHaveLength(2);
    expect(r.recorded()[1]!.subject).toBe("Two");
  });

  it("refuses to send with no recipients (mock)", async () => {
    const r = createResendMock();
    await expect(
      r.send({
        to: [],
        subject: "x",
        markdown: "x",
        idempotencyKey: "empty/1",
      }),
    ).rejects.toThrow(/no recipients/);
    expect(r.recorded()).toHaveLength(0);
  });

  it("deduplicates the same operation and rejects key reuse for another payload", async () => {
    const r = createResendMock();
    const input = {
      to: ["a@example.com"],
      subject: "Hello",
      markdown: "Hello",
      idempotencyKey: "portal/invite/abc",
    };
    const first = await r.send(input);
    const replay = await r.send(input);
    expect(replay.id).toBe(first.id);
    expect(r.recorded()).toHaveLength(1);
    await expect(
      r.send({ ...input, subject: "Changed" }),
    ).rejects.toThrow(/different payload/);
  });

  it("sends the operation key to Resend's official idempotency header", async () => {
    const previousFetch = globalThis.fetch;
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    globalThis.fetch = (async (url, init) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
    }) as typeof fetch;
    try {
      const r = createResendLive({
        apiKey: "re_test_key",
        from: "hrmny OS <noreply@hrmny.co>",
      });
      await r.send({
        to: ["a@example.com"],
        subject: "Hello",
        markdown: "Hello",
        idempotencyKey: "report/example/2026-08-28",
      });
      expect(
        (calls[0]?.[1]?.headers as Record<string, string>)["idempotency-key"],
      ).toBe("report/example/2026-08-28");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("live fails loud without RESEND_API_KEY", () => {
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      expect(() => createResendLive({ from: "test@hrmny.co" })).toThrow(
        /RESEND_API_KEY/,
      );
    } finally {
      if (prev !== undefined) process.env.RESEND_API_KEY = prev;
    }
  });

  it("live fails loud without RESEND_FROM", () => {
    const prevKey = process.env.RESEND_API_KEY;
    const prevFrom = process.env.RESEND_FROM;
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.RESEND_FROM;
    try {
      expect(() => createResendLive({})).toThrow(/RESEND_FROM/);
    } finally {
      if (prevKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prevKey;
      if (prevFrom === undefined) delete process.env.RESEND_FROM;
      else process.env.RESEND_FROM = prevFrom;
    }
  });

  it("live builds with an explicit key and from, records nothing", () => {
    const r = createResendLive({
      apiKey: "re_test_key",
      from: "hrmny OS <noreply@hrmny.co>",
    });
    expect(r.mode).toBe("live");
    expect(r.recorded()).toEqual([]);
  });

  it("defaults to mock when RESEND_MODE is unset", () => {
    const prev = process.env.RESEND_MODE;
    delete process.env.RESEND_MODE;
    try {
      expect(createResendAdapter().mode).toBe("mock");
    } finally {
      if (prev !== undefined) process.env.RESEND_MODE = prev;
    }
  });
});
