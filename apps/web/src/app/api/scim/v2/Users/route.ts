import {
  createScimUser,
  listScimUsers,
  scimErrorResponse,
  scimResponse,
} from "@/server/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return scimResponse(await listScimUsers(request));
  } catch (error) {
    return scimErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return scimResponse(await createScimUser(request), 201);
  } catch (error) {
    return scimErrorResponse(error);
  }
}
