import { Inngest } from "inngest";

/**
 * Inngest SDK client. The SDK reads INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY
 * from the environment; source code never embeds or retrieves their values.
 */
export const inngest = new Inngest({ id: "hrmny-os" });

export function inngestCloudConfigured(): boolean {
  return Boolean(
    process.env.INNGEST_EVENT_KEY?.trim() &&
      process.env.INNGEST_SIGNING_KEY?.trim(),
  );
}
