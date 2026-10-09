import type { ActionFunctionArgs } from "react-router";
import { controlAgentSchedule } from "../.server/agent-schedules.server";
import { boundedJson, scheduleErrorResponse } from "../.server/agent-schedule-http.server";
import { openDatabase, seedFixtures } from "../.server/db.server";
import { privateHeaders } from "../.server/file-content.server";
import { assertSameOrigin, resolveDemoProfile } from "../.server/profile-session.server";

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    if (request.method !== "POST")
      return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: privateHeaders });
    const profile = resolveDemoProfile(request);
    assertSameOrigin(request);
    const db = openDatabase();
    seedFixtures(db);
    const body = await boundedJson(request);
    const result = controlAgentSchedule(profile, params.scheduleId ?? "", body, db);
    const status = body && typeof body === "object" && !Array.isArray(body) && (body as Record<string, unknown>).intent === "run_now" ? 202 : 200;
    return Response.json({ result }, { status, headers: privateHeaders });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}
