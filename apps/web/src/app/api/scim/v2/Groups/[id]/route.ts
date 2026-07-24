import {
  deleteScimGroup,
  getScimGroup,
  patchScimGroup,
  replaceScimGroup,
  scimErrorResponse,
  scimResponse,
} from "@/server/scim";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    return scimResponse(await getScimGroup(request, (await context.params).id));
  } catch (error) {
    return scimErrorResponse(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    return scimResponse(
      await replaceScimGroup(request, (await context.params).id),
    );
  } catch (error) {
    return scimErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    return scimResponse(
      await patchScimGroup(request, (await context.params).id),
    );
  } catch (error) {
    return scimErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    await deleteScimGroup(request, (await context.params).id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return scimErrorResponse(error);
  }
}
