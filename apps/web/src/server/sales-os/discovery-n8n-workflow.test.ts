import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { DISCOVERY_WAKE_EVENT } from "@/server/inngest/discovery";
import { evaluateDiscoveryObservationProvenance } from "./discovery-callback-ingest";
import {
  DISCOVERY_N8N_CLOUD_BASE_URL,
  DISCOVERY_N8N_PUBLIC_NEWS_WEBHOOK_PATH,
  DISCOVERY_N8N_WEBHOOK_PATH_PATTERN,
} from "./discovery-n8n";
import {
  DISCOVERY_CALLBACK_AUDIENCE,
  DISCOVERY_CALLBACK_ISSUER,
  DISCOVERY_CALLBACK_MAX_BYTES,
  DISCOVERY_CALLBACK_MAX_LIFETIME_SECONDS,
  DISCOVERY_CALLBACK_MAX_SKEW_SECONDS,
  SALES_RESEARCH_RUN_JOB_KIND,
  signDiscoveryRuntimeToken,
  validateDiscoveryRuntimeCallback,
} from "./discovery-runtime-contract";

type JsonRecord = Record<string, unknown>;

function readRepoFile(...parts: string[]) {
  const candidates = [
    path.resolve(process.cwd(), "../..", ...parts),
    path.resolve(process.cwd(), ...parts),
  ];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) throw new Error(`Missing ${parts.join("/")}`);
  return { file, text: readFileSync(file, "utf8") };
}

function readJson(...parts: string[]) {
  return JSON.parse(readRepoFile(...parts).text) as JsonRecord;
}

function nodeByName(workflow: JsonRecord, name: string) {
  const nodes = workflow.nodes;
  if (!Array.isArray(nodes)) throw new Error("workflow.nodes");
  const node = nodes.find(
    (item) =>
      item && typeof item === "object" && (item as JsonRecord).name === name,
  );
  if (!node || typeof node !== "object") throw new Error(`missing node ${name}`);
  return node as JsonRecord;
}

function nodeCode(workflow: JsonRecord, name: string) {
  const parameters = nodeByName(workflow, name).parameters;
  if (!parameters || typeof parameters !== "object")
    throw new Error(`missing code ${name}`);
  const jsCode = (parameters as JsonRecord).jsCode;
  if (typeof jsCode !== "string") throw new Error(`missing jsCode ${name}`);
  return jsCode;
}

function runMapCodeWithoutUrlGlobal(
  code: string,
  rows: JsonRecord[],
  trigger: JsonRecord = {
    maxObservations: 20,
    permittedHosts: ["campaignme.com", "www.campaignme.com"],
  },
) {
  return runInNewContext(`(function () { ${code}\n})()`, {
    require(moduleName: string) {
      if (moduleName !== "crypto") throw new Error("MODULE_NOT_ALLOWED");
      return {
        createHash,
        randomUUID: () => "10000000-0000-4000-8000-000000000099",
      };
    },
    $: () => ({
      first: () => ({ json: trigger }),
    }),
    $input: {
      all: () => rows.map((json) => ({ json })),
    },
  }) as Array<{ json: JsonRecord }>;
}

describe("inactive Discovery public-news n8n artifacts", () => {
  const workflow = readJson("docs/automations/n8n/discovery-public-news.json");
  const contract = readJson("docs/automations/n8n/discovery-callback-contract.json");
  const scheduler = readJson("docs/automations/n8n/discovery-scheduler.json");
  const vercel = readJson("apps/web/vercel.json");

  it("keeps the public-news workflow inactive with no n8n clock", () => {
    expect(workflow.active).toBe(false);
    expect(contract.active).toBe(false);
    expect(scheduler.executionEnabled).toBe(false);
    expect(scheduler.n8n).toMatchObject({
      active: false,
      scheduleTrigger: false,
      webhookPath: DISCOVERY_N8N_PUBLIC_NEWS_WEBHOOK_PATH,
    });
    const nodes = workflow.nodes;
    expect(Array.isArray(nodes)).toBe(true);
    for (const node of nodes as JsonRecord[]) {
      expect(String(node.type)).not.toMatch(/schedule/i);
    }
    const serialized = JSON.stringify(workflow);
    expect(serialized).not.toMatch(/n8n-nodes-base\.scheduleTrigger/);
    expect(serialized).not.toMatch(/BEGIN [A-Z]+ PRIVATE KEY/);
    expect(serialized).not.toMatch(/sk_live|sk-ant|whsec_|postgres(ql)?:\/\//i);
  });

  it("compiles every workflow Code node as JavaScript", () => {
    const nodes = workflow.nodes as JsonRecord[];
    for (const node of nodes.filter(
      (candidate) => candidate.type === "n8n-nodes-base.code",
    )) {
      const code = nodeCode(workflow, String(node.name));
      expect(
        () => new Script(`(function () { ${code}\n})`),
        String(node.name),
      ).not.toThrow();
    }
  });

  it("binds the webhook, callback, and Campaign ME feed to the existing OS contract", () => {
    const webhook = nodeByName(workflow, "Discovery Public-News Webhook");
    const webhookPath = (webhook.parameters as JsonRecord).path;
    expect(webhookPath).toBe(DISCOVERY_N8N_PUBLIC_NEWS_WEBHOOK_PATH);
    expect((webhook.parameters as JsonRecord).authentication).toBe("headerAuth");
    expect(webhook.credentials).toMatchObject({
      httpHeaderAuth: {
        name: "HRMNY Discovery OS trigger",
      },
    });
    expect(webhook.credentials).not.toHaveProperty("headerAuth");
    expect(DISCOVERY_N8N_WEBHOOK_PATH_PATTERN.test(String(webhookPath))).toBe(
      true,
    );
    expect(contract).toMatchObject({
      webhookPath: DISCOVERY_N8N_PUBLIC_NEWS_WEBHOOK_PATH,
      callbackPath: "/api/integrations/discovery/callback",
      callbackHeader: "x-hrmny-discovery-token",
      inboundTriggerHeader: "X-Hrmny-Os-Secret",
      issuer: DISCOVERY_CALLBACK_ISSUER,
      audience: DISCOVERY_CALLBACK_AUDIENCE,
      algorithm: "HS256",
      maxLifetimeSeconds: DISCOVERY_CALLBACK_MAX_LIFETIME_SECONDS,
      maxSkewSeconds: DISCOVERY_CALLBACK_MAX_SKEW_SECONDS,
      maxBodyBytes: DISCOVERY_CALLBACK_MAX_BYTES,
      n8nBaseUrl: DISCOVERY_N8N_CLOUD_BASE_URL,
    });
    expect(contract.events).toEqual([
      "sales.discovery.observations.v1",
      "sales.discovery.checkpoint.v1",
      "sales.discovery.completion.v1",
    ]);
    const firstCollector = contract.firstCollector as JsonRecord;
    expect(firstCollector).toMatchObject({
      sourceKey: "campaign_me",
      url: "https://campaignme.com/latest/",
      feedUrl: "https://campaignme.com/feed/",
    });
    expect(nodeByName(workflow, "Read Public News Feed").parameters).toMatchObject({
      url: "={{ $json.feedUrl }}",
    });
    const serialized = JSON.stringify(workflow);
    expect(serialized).toContain("x-hrmny-discovery-token");
    const prepareCode = nodeCode(workflow, "Prepare Discovery Callbacks");
    expect(prepareCode).toContain(DISCOVERY_CALLBACK_ISSUER);
    expect(prepareCode).toContain(DISCOVERY_CALLBACK_AUDIENCE);
    expect(prepareCode).toContain("sales.discovery.observations.v1");
    expect(prepareCode).toContain("sales.discovery.completion.v1");
    expect(prepareCode).toContain("/api/integrations/discovery/callback");
    expect(prepareCode).toContain("bodyHash");
    expect(prepareCode).not.toContain("DISCOVERY_N8N_CALLBACK_SECRET");
    expect(prepareCode).not.toContain("createHmac");
    for (const name of ["Sign Observations JWT", "Sign Completion JWT"]) {
      const signer = nodeByName(workflow, name);
      expect(signer.type).toBe("n8n-nodes-base.jwt");
      expect(signer.credentials).toMatchObject({
        jwtAuth: { name: "HRMNY Discovery callback signing" },
      });
      expect(signer.parameters).toMatchObject({
        operation: "sign",
        useJson: true,
        options: { algorithm: "HS256" },
      });
    }
    const normalizeCode = nodeCode(workflow, "Normalize Trigger");
    expect(normalizeCode).toContain("configuration.feedUrl");
    expect(normalizeCode).toContain("permittedHosts");
    const mapCode = nodeCode(workflow, "Map Public-News Observations");
    expect(mapCode).toContain("trigger.permittedHosts");
    expect(mapCode).toContain("public_url");
    expect(mapCode).toContain("quarantined: observations.filter");
    expect(mapCode).toContain("companyHints.length === 0");
    expect(mapCode).not.toContain("new URL");
  });

  it("does not attach the Discovery repair clock to the generic Vercel cron", () => {
    expect(scheduler.repair).toMatchObject({
      path: "/api/cron/discovery",
      secretEnv: "DISCOVERY_REPAIR_SECRET",
      collects: false,
    });
    expect(scheduler.inngest).toMatchObject({
      functionId: "sales-discovery-wake-v1",
      event: DISCOVERY_WAKE_EVENT,
      collectsWhenDisabled: false,
    });
    expect(scheduler.genericBusinessCron).toMatchObject({
      path: "/api/cron/jobs",
      excludesJobKind: SALES_RESEARCH_RUN_JOB_KIND,
      doNotIncreaseCadence: true,
    });
    expect(scheduler.vercelRepairCron).toMatchObject({
      path: "/api/cron/discovery",
      appliedInRepo: false,
    });
    const crons = vercel.crons;
    expect(Array.isArray(crons)).toBe(true);
    expect(
      (crons as Array<{ path?: string }>).some(
        (item) => item.path === "/api/cron/discovery",
      ),
    ).toBe(false);
  });

  it("maps pinned Campaign ME URLs when the n8n Cloud URL global is absent", () => {
    const mapCode = nodeCode(workflow, "Map Public-News Observations");
    expect(mapCode).not.toContain("new URL");
    const valid = {
      link: "https://campaignme.com/latest/agency-wins-brief/",
      guid: "campaign-me-valid-item",
      title: "Agency wins a regional brief",
      contentSnippet: "Campaign ME published a public-news item.",
      isoDate: "2026-09-20T00:00:00.000Z",
    };
    const mapped = runMapCodeWithoutUrlGlobal(mapCode, [
      valid,
      { ...valid, guid: "external", link: "https://evil.example/story" },
    ])[0]!.json;
    expect(mapped.observations).toEqual([
      expect.objectContaining({
        sourceItemKey: valid.guid,
        sourceReference: {
          kind: "public_url",
          url: valid.link,
        },
      }),
    ]);
    expect(mapped.completion).toMatchObject({
      status: "completed",
      counts: { quarantined: 1, rejected: 1 },
    });

    for (const link of [
      "https://evil.example/story",
      "https://campaignme.com/story?redirect=https://evil.example",
      "https://campaignme.com/story#fragment",
      "https://user@campaignme.com/story",
      "https://campaignme.com:443/story",
      "https://campaignme.com//evil.example/story",
      "https://campaignme.com\\evil.example/story",
      "https://campaignme.com/story\nnext",
    ]) {
      const rejected = runMapCodeWithoutUrlGlobal(mapCode, [
        { ...valid, guid: link, link },
      ])[0]!.json;
      expect(rejected.observations, link).toEqual([]);
      expect(rejected.completion, link).toMatchObject({
        status: "failed",
        counts: { rejected: 1 },
        error: { code: "contract_invalid", retryable: false },
      });
    }

    const communicate = {
      link: "https://communicateonline.me/news/fp7-mccann-mullenlowe-to-merge-as-mccann-mena/",
      guid: "https://communicateonline.me/?p=30643",
      title: "FP7 McCann, MullenLowe to merge as McCann MENA",
      contentSnippet: "Communicate Online published a public-news item.",
      isoDate: "2026-09-21T06:44:43.000Z",
    };
    const communicateMapped = runMapCodeWithoutUrlGlobal(
      mapCode,
      [communicate],
      {
        maxObservations: 20,
        permittedHosts: ["communicateonline.me", "www.communicateonline.me"],
      },
    )[0]!.json;
    expect(communicateMapped.observations).toEqual([
      expect.objectContaining({
        sourceItemKey: communicate.guid,
        sourceReference: {
          kind: "public_url",
          url: communicate.link,
        },
      }),
    ]);
  });

  it("signs a Campaign ME observation the same way the workflow Code node and OS validator expect", () => {
    const secret = "n8n-discovery-callback-secret-32b";
    const keyId = "n8n-2026-09";
    const eventId = "10000000-0000-4000-8000-000000000021";
    const url = "https://campaignme.com/latest/agency-wins-brief/";
    expect(
      evaluateDiscoveryObservationProvenance({
        url,
        configuration: {
          url: "https://campaignme.com/latest/",
          feedUrl: "https://campaignme.com/feed/",
        },
      }),
    ).toEqual({ ok: true, url });

    const rawBody = JSON.stringify({
      schemaVersion: 1,
      event: "sales.discovery.observations.v1",
      eventId,
      runId: "10000000-0000-4000-8000-000000000022",
      sourceId: "10000000-0000-4000-8000-000000000023",
      attemptToken: "10000000-0000-4000-8000-000000000024",
      attemptGeneration: 1,
      credentialGeneration: 1,
      payload: {
        observations: [
          {
            observationId: "10000000-0000-4000-8000-000000000025",
            sourceItemKey: "https://campaignme.com/latest/agency-wins-brief/",
            contentHash: createHash("sha256")
              .update("campaign-me-article", "utf8")
              .digest("hex"),
            sourceReference: { kind: "public_url", url },
            observedAt: "2026-09-21T00:00:00.000Z",
            publishedAt: "2026-09-20T00:00:00.000Z",
            dateEvidence: { method: "feed", precision: "day" },
            kind: "news",
            title: "Agency wins a regional brief",
            excerpt: "Campaign ME published a public-news item.",
            companyHints: [],
          },
        ],
        checkpoint: {
          cursor: "https://campaignme.com/latest/agency-wins-brief/",
          providerJobId: null,
          itemsSeen: 1,
          pagesSeen: 1,
        },
      },
    });
    const prepareCode = nodeCode(workflow, "Prepare Discovery Callbacks");
    expect(prepareCode).toContain("iss: 'hrmny-n8n-discovery'");
    expect(prepareCode).toContain("aud: 'hrmny-os-discovery'");
    const token = signDiscoveryRuntimeToken(
      secret,
      keyId,
      rawBody,
      eventId,
      1_790_000_000,
    );
    expect(
      validateDiscoveryRuntimeCallback({
        rawBody,
        headers: new Headers({ "x-hrmny-discovery-token": token }),
        keys: { [keyId]: secret },
        nowSeconds: 1_790_000_000,
      }),
    ).toMatchObject({ ok: true, eventId, keyId });
  });
});
