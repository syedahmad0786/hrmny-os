import {
  requireScim,
  scimErrorResponse,
  scimResourceTypes,
  scimResponse,
} from "@/server/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireScim(request);
    return scimResponse(scimResourceTypes(request));
  } catch (error) {
    return scimErrorResponse(error);
  }
}
