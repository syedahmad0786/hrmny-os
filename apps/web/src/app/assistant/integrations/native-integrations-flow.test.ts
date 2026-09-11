import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const integrationsPage = readFileSync(
  new URL("./page.tsx", import.meta.url),
  "utf8",
);
const sessionPage = readFileSync(
  new URL("./session/page.tsx", import.meta.url),
  "utf8",
);
const connectionsPage = readFileSync(
  new URL(
    "../../(staff)/settings/connections/connections-page-content.tsx",
    import.meta.url,
  ),
  "utf8",
);

it("binds the native proof and OS session transfer to exact origins, sources, and nonce", () => {
  expect(integrationsPage).toContain(
    'const NATIVE_ORIGIN = "https://hrmny-portal.fly.dev"',
  );
  expect(integrationsPage).toMatch(
    /event\.origin !== NATIVE_ORIGIN \|\| event\.source !== source/,
  );
  expect(integrationsPage).toMatch(
    /event\.origin !== window\.location\.origin \|\|\s*event\.source !== popupRef\.current/,
  );
  expect(integrationsPage).toContain(
    '{ type: "hrmny-integrations-challenge", nonce }',
  );
  expect(sessionPage).toMatch(
    /event\.origin !== window\.location\.origin \|\| event\.source !== opener/,
  );
  expect(sessionPage).toContain("data.nonce !== nonce");
  expect(sessionPage).toContain(
    "Signed in. Return to hrmny and press Continue securely again.",
  );
  expect(sessionPage).not.toMatch(/[?&](accessToken|refreshToken|proof)=/);
  expect(
    integrationsPage.indexOf("await verifySession(accessToken"),
  ).toBeLessThan(integrationsPage.indexOf("client.auth.setSession"));
  expect(integrationsPage).not.toContain("client.auth.signOut");
  expect(integrationsPage).toMatch(/if \(!popup\) \{\s*setState\("login"\)/);
});

it("opens provider authorization outside the iframe and bounds status refresh", () => {
  expect(connectionsPage).toMatch(/window\.open\(\s*"about:blank"/);
  expect(connectionsPage).toContain(
    'popup.sessionStorage.setItem("hrmny-integrations-oauth", "1")',
  );
  expect(connectionsPage).toContain(
    "popup.location.replace(result.redirectUrl)",
  );
  expect(connectionsPage).toContain("}, 2 * 60_000)");
  expect(connectionsPage).toContain(
    '{ type: "hrmny-integrations-oauth-complete", ok }',
  );
  expect(connectionsPage).not.toMatch(/authorizeManaged\.mutate\(/);
});
