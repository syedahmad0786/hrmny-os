import {
  googleChatEndpoint,
  handleGoogleChatRequest,
} from "@/server/google-chat";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return Response.json({
    ok: true,
    endpoint: googleChatEndpoint(new URL(request.url).origin),
    authentication: "Google-signed OIDC bearer token",
  });
}

export async function POST(request: Request) {
  return handleGoogleChatRequest(request);
}
