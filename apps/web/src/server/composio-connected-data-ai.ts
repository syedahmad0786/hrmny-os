import type { ComposioLiveClient } from "@hrmny/integrations";
import type { WorkAiContextSource } from "./work-ai";

export const composioAiConnectedApps = [
  {
    app: "one_drive",
    label: "OneDrive",
    toolSlug: "ONE_DRIVE_SEARCH_DRIVE_ITEMS",
  },
  {
    app: "outlook",
    label: "Outlook",
    toolSlug: "OUTLOOK_SEARCH_MESSAGES",
  },
  { app: "slack", label: "Slack", toolSlug: "SLACK_SEARCH_MESSAGES" },
  {
    app: "microsoft_teams",
    label: "Microsoft Teams",
    toolSlug: "MICROSOFT_TEAMS_SEARCH_MESSAGES",
  },
  { app: "jira", label: "Jira", toolSlug: "JIRA_SEARCH_ISSUES" },
] as const;

export type ComposioAiConnectedApp =
  (typeof composioAiConnectedApps)[number]["app"];

export async function searchComposioConnectedData(input: {
  client: ComposioLiveClient;
  connectedAccountId: string;
  app: ComposioAiConnectedApp;
  query: string;
}): Promise<WorkAiContextSource[]> {
  const definition = composioAiConnectedApps.find(
    (candidate) => candidate.app === input.app,
  )!;
  const query = input.query.trim().slice(0, 2_000);
  if (!query) return [];
  const data = await input.client.executeTool({
    connectedAccountId: input.connectedAccountId,
    toolSlug: definition.toolSlug,
    text: `Search ${definition.label} for this work request and return at most 5 relevant results. Do not change any external data. Request: ${query}`,
  });
  return [
    {
      id: `connected:${definition.app}`,
      type: "external_file",
      label: `${definition.label} search results`,
      content: JSON.stringify({ provider: definition.label, data }).slice(
        0,
        20_000,
      ),
    },
  ];
}
