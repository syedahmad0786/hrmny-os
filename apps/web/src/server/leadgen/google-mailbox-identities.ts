import { z } from "zod";

export class GmailSenderIdentityError extends Error {}

const identitiesSchema = z.object({
  sendAs: z
    .array(
      z.object({
        sendAsEmail: z.string().email(),
        displayName: z.string().optional(),
        isPrimary: z.boolean().optional(),
        verificationStatus: z.string().optional(),
      }),
    )
    .default([]),
});

export function verifiedGmailIdentities(value: unknown) {
  return identitiesSchema
    .parse(value)
    .sendAs.filter(
      (identity) =>
        identity.isPrimary || identity.verificationStatus === "accepted",
    )
    .map((identity) => ({
      email: identity.sendAsEmail.toLowerCase(),
      name: identity.displayName ?? "",
      primary: Boolean(identity.isPrimary),
    }));
}

/** gmail.readonly already permits sendAs.list; never creates or verifies an alias. */
export async function listGmailIdentities(accessToken: string) {
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs",
    {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Could not load verified sender addresses (${response.status}). Reconnect this mailbox if access has expired.`,
    );
  return verifiedGmailIdentities(await response.json());
}
