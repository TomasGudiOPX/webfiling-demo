import type { ActionFunctionArgs } from "react-router";
import { applyAgentPlan } from "../.server/agent-plans.server";
import { scheduleErrorResponse } from "../.server/agent-schedule-http.server";
import { openDatabase, seedFixtures } from "../.server/db.server";
import { privateHeaders } from "../.server/file-content.server";
import { assertSameOrigin, resolveDemoProfile } from "../.server/profile-session.server";

export function action({ request, params }: ActionFunctionArgs) {
  try {
    if (request.method !== "POST") return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: privateHeaders });
    const profile = resolveDemoProfile(request);
    assertSameOrigin(request);
    const db = openDatabase();
    seedFixtures(db);
    return Response.json({ run: applyAgentPlan(profile, params.planId ?? "", db) }, { status: 202, headers: privateHeaders });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}
