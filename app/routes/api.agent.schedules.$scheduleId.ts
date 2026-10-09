import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  archiveAgentSchedule,
  getAgentSchedule,
  updateAgentSchedule,
} from "../.server/agent-schedules.server";
import { boundedJson, scheduleErrorResponse } from "../.server/agent-schedule-http.server";
import { openDatabase, seedFixtures } from "../.server/db.server";
import { privateHeaders } from "../.server/file-content.server";
import { assertSameOrigin, resolveDemoProfile } from "../.server/profile-session.server";

export function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const profile = resolveDemoProfile(request);
    const db = openDatabase();
    seedFixtures(db);
    return Response.json({ schedule: getAgentSchedule(profile, params.scheduleId ?? "", db) }, { headers: privateHeaders });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    if (request.method !== "PATCH" && request.method !== "DELETE")
      return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: privateHeaders });
    const profile = resolveDemoProfile(request);
    assertSameOrigin(request);
    const db = openDatabase();
    seedFixtures(db);
    const body = await boundedJson(request);
    if (request.method === "DELETE") {
      const version = body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).version
        : undefined;
      return Response.json({ schedule: archiveAgentSchedule(profile, params.scheduleId ?? "", version, db) }, { headers: privateHeaders });
    }
    return Response.json({ schedule: updateAgentSchedule(profile, params.scheduleId ?? "", body, db) }, { headers: privateHeaders });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}
