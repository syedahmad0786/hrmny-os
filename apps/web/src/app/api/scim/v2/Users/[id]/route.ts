import {
  deleteScimUser,
  getScimUser,
  patchScimUser,
  replaceScimUser,
  scimErrorResponse,
  scimResponse,
} from "@/server/scim";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    return scimResponse(await getScimUser(request, (await context.params).id));
  } catch (error) {
    return scimErrorResponse(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    return scimResponse(
      await replaceScimUser(request, (await context.params).id),
    );
  } catch (error) {
    return scimErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    return scimResponse(
      await patchScimUser(request, (await context.params).id),
    );
  } catch (error) {
    return scimErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    await deleteScimUser(request, (await context.params).id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return scimErrorResponse(error);
  }
}
