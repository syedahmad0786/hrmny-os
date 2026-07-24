import { receiveAsanaWebhook } from "@/server/asana-webhooks";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: Context) {
  try {
    return await receiveAsanaWebhook(request, (await context.params).token);
  } catch (error) {
    console.error("Asana webhook failed", error);
    return new Response("Webhook failed", { status: 500 });
  }
}
