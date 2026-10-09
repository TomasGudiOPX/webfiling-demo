import type { ActionFunctionArgs } from "react-router";
import { matchManagedUploadEvidence } from "../.server/collection-evidence.server";
import { boundedJson, scheduleErrorResponse } from "../.server/agent-schedule-http.server";
import { openDatabase, seedFixtures } from "../.server/db.server";
import { privateHeaders } from "../.server/file-content.server";
import { assertSameOrigin, resolveDemoProfile } from "../.server/profile-session.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    if (request.method !== "POST") return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: privateHeaders });
    assertSameOrigin(request);
    const profile = resolveDemoProfile(request);
    const body = await boundedJson(request) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["fileId", "periodId", "slotKey"].includes(key)) ||
        typeof body.fileId !== "string" || typeof body.periodId !== "string" || typeof body.slotKey !== "string") {
      return Response.json({ error: { code: "invalid_request", message: "Selecciona un archivo y un espacio válidos." } }, { status: 400, headers: privateHeaders });
    }
    const db = openDatabase();
    seedFixtures(db);
    const result = matchManagedUploadEvidence(profile, body.fileId, { periodId: body.periodId, slotKey: body.slotKey }, db);
    if (result.status === "not_matched")
      return Response.json({ error: { code: "not_available", message: "Ese archivo no puede vincularse a este espacio." } }, { status: 404, headers: privateHeaders });
    return Response.json({ result }, { headers: privateHeaders });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}
