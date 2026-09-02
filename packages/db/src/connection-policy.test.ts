import { describe, expect, it } from "vitest";
import { resolveDatabaseSsl } from "./index";

const localUrl = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const remoteUrl = "postgresql://postgres:secret@db.example.com:5432/postgres";

describe("database SSL policy", () => {
  it("requires TLS by default", () => {
    expect(resolveDatabaseSsl(localUrl, {})).toBe("require");
    expect(resolveDatabaseSsl(remoteUrl, {})).toBe("require");
  });

  it("rejects unknown modes", () => {
    expect(() =>
      resolveDatabaseSsl(localUrl, {
        HRMNY_DATABASE_SSL_MODE: "prefer",
      }),
    ).toThrow("HRMNY_DATABASE_SSL_MODE must be require or disable");
  });

  it("rejects a TLS downgrade without every disposable-CI gate", () => {
    expect(() =>
      resolveDatabaseSsl(localUrl, {
        HRMNY_DATABASE_SSL_MODE: "disable",
      }),
    ).toThrow("DATABASE_SSL_DISABLE_FORBIDDEN");
    expect(() =>
      resolveDatabaseSsl(remoteUrl, {
        CI: "true",
        HRMNY_CI_POSTGRES_WRITE: "true",
        HRMNY_DATABASE_SSL_MODE: "disable",
      }),
    ).toThrow("DATABASE_SSL_DISABLE_FORBIDDEN");
  });

  it("allows plaintext only for the explicit local disposable CI database", () => {
    expect(
      resolveDatabaseSsl(localUrl, {
        CI: "true",
        HRMNY_CI_POSTGRES_WRITE: "true",
        HRMNY_DATABASE_SSL_MODE: "disable",
      }),
    ).toBe(false);
  });
});
