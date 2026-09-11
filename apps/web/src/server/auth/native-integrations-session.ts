import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/supabase-config";
import { resolveSupabaseUser } from "./session";
import { verifyNativeIntegrationsProof } from "./native-integrations-proof";

type GoogleIdentity = { issuer: string; subject: string };

function googleIdentityFromUser(user: {
  identities?: Array<{
    provider?: string;
    identity_id?: string;
    identity_data?: Record<string, unknown>;
  }> | null;
}): GoogleIdentity | null {
  const identity = user.identities?.find((item) => item.provider === "google");
  if (!identity) return null;
  const subject =
    typeof identity.identity_data?.sub === "string"
      ? identity.identity_data.sub
      : identity.identity_id;
  if (!subject || !/^[0-9]{1,255}$/.test(subject)) return null;
  const rawIssuer = identity.identity_data?.iss;
  if (
    rawIssuer !== undefined &&
    rawIssuer !== "accounts.google.com" &&
    rawIssuer !== "https://accounts.google.com"
  )
    return null;
  return { issuer: "https://accounts.google.com", subject };
}

async function verifiedSupabaseIdentity(accessToken: string) {
  const config = getSupabasePublicConfig();
  if (!config) throw new Error("SUPABASE_NOT_CONFIGURED");
  const client = createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) return null;
  const principal = data.user.email?.trim().toLowerCase();
  const googleIdentity = googleIdentityFromUser(data.user);
  if (!principal || !googleIdentity) return null;
  return { principal, ...googleIdentity };
}

export async function verifyNativeIntegrationsSession(input: {
  accessToken: string;
  proof: string;
  nonce: string;
  secret: string;
}): Promise<
  { ok: true; employeeId: string; principal: string } | { ok: false }
> {
  const claims = verifyNativeIntegrationsProof(
    input.proof,
    input.nonce,
    input.secret,
  );
  if (!claims) return { ok: false };
  const [sessionUser, googleIdentity] = await Promise.all([
    resolveSupabaseUser(input.accessToken),
    verifiedSupabaseIdentity(input.accessToken),
  ]);
  if (
    !sessionUser ||
    sessionUser.actorType !== "staff" ||
    sessionUser.clientId !== null ||
    !googleIdentity ||
    sessionUser.email !== claims.p ||
    googleIdentity.principal !== claims.p ||
    googleIdentity.issuer !== "https://accounts.google.com" ||
    claims.sub !== googleIdentity.subject
  )
    return { ok: false };
  return {
    ok: true,
    employeeId: sessionUser.employeeId,
    principal: claims.p,
  };
}
