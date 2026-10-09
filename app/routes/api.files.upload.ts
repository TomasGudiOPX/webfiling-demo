import type { ActionFunctionArgs } from "react-router";
import { openDatabase, seedFixtures } from "../.server/db.server";
import { assertSameOrigin, ProfileContextError, resolveDemoProfile } from "../.server/profile-session.server";
import { saveManagedUpload } from "../.server/managed-upload.server";
import { boundedFormData, FileInputError } from "../.server/upload-validation.server";
import { privateHeaders } from "../.server/file-content.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const profile = resolveDemoProfile(request);
    assertSameOrigin(request);
    const form = await boundedFormData(request);
    const file = form.get("file");
    if (!(file instanceof File) || Array.from(form.values()).filter(value => value instanceof File).length !== 1)
      return Response.json({ error: { code: "invalid_upload", message: "One file is required." } }, { status: 400 });
    const db = openDatabase();
    seedFixtures(db);
    const upload = await saveManagedUpload(
      profile,
      { collectionId: String(form.get("collectionId") ?? ""), file, folderId: String(form.get("folderId") ?? "") || null, projectIds: form.getAll("projectId").map(String) },
      db,
    );
    return Response.json({ file: upload }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: { code: "invalid_upload", message: error instanceof FileInputError || error instanceof ProfileContextError ? error.message : "No se pudo guardar el archivo. Intente nuevamente." } },
      { status: error instanceof FileInputError || error instanceof ProfileContextError ? error.status : 500, headers: privateHeaders },
    );
  }
}
