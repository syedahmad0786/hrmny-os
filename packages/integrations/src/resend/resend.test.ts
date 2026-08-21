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
    });
    expect(res.mode).toBe("mock");
    expect(res.id).toBeTruthy();
    expect(res.to).toEqual(["a@example.com"]);
    expect(r.recorded()).toHaveLength(1);

    await r.send({ to: ["b@example.com"], subject: "Two", markdown: "x" });
    expect(r.recorded()).toHaveLength(2);
    expect(r.recorded()[1]!.subject).toBe("Two");
  });

  it("refuses to send with no recipients (mock)", async () => {
    const r = createResendMock();
    await expect(
      r.send({ to: [], subject: "x", markdown: "x" }),
    ).rejects.toThrow(/no recipients/);
    expect(r.recorded()).toHaveLength(0);
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
