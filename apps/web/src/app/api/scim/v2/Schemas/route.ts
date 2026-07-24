import {
  requireScim,
  scimErrorResponse,
  scimSchemas,
  scimResponse,
} from "@/server/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireScim(request);
    return scimResponse(scimSchemas());
  } catch (error) {
    return scimErrorResponse(error);
  }
}
