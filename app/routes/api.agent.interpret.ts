import type { ActionFunctionArgs } from "react-router";
import { collectionCapabilities, canReadFile } from "../.server/file-access.server";
import { boundedJson, scheduleErrorResponse } from "../.server/agent-schedule-http.server";
import { openDatabase, seedFixtures } from "../.server/db.server";
import { privateHeaders } from "../.server/file-content.server";
import { assertSameOrigin, resolveDemoProfile } from "../.server/profile-session.server";
import { interpretDemoIntent } from "../.server/demo-agent-provider.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    if (request.method !== "POST") return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: privateHeaders });
    assertSameOrigin(request);
    const profileId = resolveDemoProfile(request);
    const input = await boundedJson(request) as Record<string, unknown>;
    if (Object.keys(input).length !== 1 || typeof input.intent !== "string")
      return Response.json({ error: { code: "invalid_operation", message: "La solicitud no es válida." } }, { status: 400, headers: privateHeaders });
    const db = openDatabase();
    seedFixtures(db);
    const collections = (db.prepare("SELECT id,name FROM collections ORDER BY name LIMIT 100").all() as Array<{ id: string; name: string }>)
      .filter((collection) => collectionCapabilities(profileId, collection.id, db).canRead);
    const files = (db.prepare("SELECT f.id,m.display_name AS name FROM files f JOIN library_file_metadata m ON m.file_id=f.id WHERE m.trashed_at IS NULL ORDER BY f.updated_at DESC LIMIT 500").all() as Array<{ id: string; name: string }>)
      .filter((file) => canReadFile(profileId, file.id, db));
    return Response.json({ interpretation: interpretDemoIntent(input.intent, { profileId, collections, files }) }, { headers: privateHeaders });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}
