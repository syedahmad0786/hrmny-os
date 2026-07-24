import {
  requireScim,
  scimErrorResponse,
  scimResourceTypes,
  scimResponse,
} from "@/server/scim";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    await requireScim(request);
    return scimResponse(scimResourceTypes(request, (await context.params).id));
  } catch (error) {
    return scimErrorResponse(error);
  }
}
