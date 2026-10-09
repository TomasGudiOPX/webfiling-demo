import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getCollectionRule, updateCollectionRule } from "../.server/collection-rules.server";
import { boundedJson, scheduleErrorResponse } from "../.server/agent-schedule-http.server";
import { openDatabase, seedFixtures } from "../.server/db.server";
import { privateHeaders } from "../.server/file-content.server";
import { assertSameOrigin, resolveDemoProfile } from "../.server/profile-session.server";

export function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const profile = resolveDemoProfile(request);
    const db = openDatabase();
    seedFixtures(db);
    return Response.json({ rule: getCollectionRule(profile, params.ruleId ?? "", db) }, { headers: privateHeaders });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    if (request.method !== "PATCH") return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: privateHeaders });
    const profile = resolveDemoProfile(request);
    assertSameOrigin(request);
    const db = openDatabase();
    seedFixtures(db);
    const rule = updateCollectionRule(profile, params.ruleId ?? "", await boundedJson(request), db);
    return Response.json({ rule }, { headers: privateHeaders });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}
