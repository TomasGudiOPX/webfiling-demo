import type { ActionFunctionArgs } from "react-router";
import { setCollectionRuleState } from "../.server/collection-rules.server";
import { boundedJson, scheduleErrorResponse } from "../.server/agent-schedule-http.server";
import { openDatabase, seedFixtures } from "../.server/db.server";
import { privateHeaders } from "../.server/file-content.server";
import { assertSameOrigin, resolveDemoProfile } from "../.server/profile-session.server";

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    if (request.method !== "POST") return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: privateHeaders });
    const profile = resolveDemoProfile(request);
    assertSameOrigin(request);
    const body = await boundedJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return Response.json({ error: { code: "invalid" } }, { status: 400, headers: privateHeaders });
    const value = body as Record<string, unknown>;
    if (typeof value.intent !== "string" || !["enable", "disable", "pause", "resume", "archive", "adopt"].includes(value.intent) || !Number.isSafeInteger(value.version))
      return Response.json({ error: { code: "invalid" } }, { status: 400, headers: privateHeaders });
    const db = openDatabase();
    seedFixtures(db);
    const rule = setCollectionRuleState(profile, params.ruleId ?? "", value.intent as "enable" | "disable" | "pause" | "resume" | "archive" | "adopt", Number(value.version), db);
    return Response.json({ rule }, { headers: privateHeaders });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}
