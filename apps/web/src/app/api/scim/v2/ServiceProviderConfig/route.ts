import {
  requireScim,
  scimErrorResponse,
  scimResponse,
  scimServiceProviderConfig,
} from "@/server/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireScim(request);
    return scimResponse(scimServiceProviderConfig());
  } catch (error) {
    return scimErrorResponse(error);
  }
}
