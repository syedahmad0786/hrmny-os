import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncHrmnyPwa } from "./pwa-register";

describe("Feature Lab PWA boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("unregisters only the hrmny worker and clears only its shell cache", async () => {
    const hrmnyUnregister = vi.fn(async () => true);
    const otherUnregister = vi.fn(async () => true);
    const remove = vi.fn();
    const deleteCache = vi.fn(async () => true);
    vi.stubGlobal("document", {
      querySelectorAll: () => [{ remove }],
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: async () => [
          {
            active: { scriptURL: "https://portal.hrmny.co/sw.js" },
            waiting: null,
            installing: null,
            unregister: hrmnyUnregister,
          },
          {
            active: { scriptURL: "https://portal.hrmny.co/other.js" },
            waiting: null,
            installing: null,
            unregister: otherUnregister,
          },
        ],
      },
    });
    vi.stubGlobal("caches", {
      keys: async () => ["hrmny-shell-v1", "other-cache"],
      delete: deleteCache,
    });

    await syncHrmnyPwa(false);

    expect(remove).toHaveBeenCalledOnce();
    expect(hrmnyUnregister).toHaveBeenCalledOnce();
    expect(otherUnregister).not.toHaveBeenCalled();
    expect(deleteCache).toHaveBeenCalledWith("hrmny-shell-v1");
    expect(deleteCache).not.toHaveBeenCalledWith("other-cache");
  });

  it("keeps unrelated caches when the worker activates", () => {
    expect(readFileSync(join(process.cwd(), "public/sw.js"), "utf8")).toContain(
      'key.startsWith("hrmny-shell-") && key !== CACHE',
    );
  });
});
