import type { ActionFunctionArgs } from "react-router";
import { createAgentPlan, AgentPlanError } from "../.server/agent-plans.server";
import { boundedJson, scheduleErrorResponse } from "../.server/agent-schedule-http.server";
import { openDatabase, seedFixtures } from "../.server/db.server";
import { privateHeaders } from "../.server/file-content.server";
import { assertSameOrigin, resolveDemoProfile } from "../.server/profile-session.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    if (request.method !== "POST") return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: privateHeaders });
    const profile = resolveDemoProfile(request);
    assertSameOrigin(request);
    const input = await boundedJson(request) as Record<string, unknown>;
    if (Object.keys(input).some((key) => !["providerVersion", "intent", "operation", "reason"].includes(key)) ||
        typeof input.providerVersion !== "string" || typeof input.intent !== "string" || typeof input.reason !== "string")
      throw new AgentPlanError("invalid_operation", 400);
    const db = openDatabase();
    seedFixtures(db);
    const plan = createAgentPlan(profile, input.providerVersion, input.intent, input.operation, input.reason, db);
    return Response.json({ plan }, { status: 201, headers: privateHeaders });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}
