import { describe, expect, it } from "vitest";
import { materializeResponse } from "./materialize-response";

describe("materializeResponse", () => {
  it("buffers a streamed response and preserves its contract", async () => {
    const source = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":'));
          controller.enqueue(new TextEncoder().encode("true}"));
          controller.close();
        },
      }),
      {
        status: 202,
        statusText: "Accepted",
        headers: { "content-type": "application/json", "x-receipt": "r1" },
      },
    );

    const result = await materializeResponse(source);

    expect(result.status).toBe(202);
    expect(result.statusText).toBe("Accepted");
    expect(result.headers.get("content-type")).toBe("application/json");
    expect(result.headers.get("x-receipt")).toBe("r1");
    expect(result.headers.get("content-length")).toBe("11");
    expect(await result.text()).toBe('{"ok":true}');
  });

  it("keeps bodyless responses bodyless", async () => {
    const result = await materializeResponse(new Response(null, { status: 204 }));

    expect(result.status).toBe(204);
    expect(result.body).toBeNull();
  });
});
