import { handleComposioPost } from "./handler";

export const dynamic = "force-dynamic";

export const POST = (request: Request) => handleComposioPost(request);

export async function GET() {
  return Response.json({
    ok: true,
    endpoint: "/api/webhooks/composio",
    methods: ["POST"],
    signature:
      "webhook-signature v1,base64 HMAC over webhook-id.timestamp.body",
    docs: "https://docs.composio.dev/docs/webhook-verification",
  });
}
