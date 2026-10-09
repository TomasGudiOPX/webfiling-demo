import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createCollectionRule, listCollectionRules } from "../.server/collection-rules.server";
import { boundedJson, scheduleErrorResponse } from "../.server/agent-schedule-http.server";
import { openDatabase, seedFixtures } from "../.server/db.server";
import { privateHeaders } from "../.server/file-content.server";
import { assertSameOrigin, resolveDemoProfile } from "../.server/profile-session.server";

export function loader({ request }: LoaderFunctionArgs) {
  try {
    const profile = resolveDemoProfile(request);
    const db = openDatabase();
    seedFixtures(db);
    return Response.json({ rules: listCollectionRules(profile, db) }, { headers: privateHeaders });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    if (request.method !== "POST") return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: privateHeaders });
    const profile = resolveDemoProfile(request);
    assertSameOrigin(request);
    const db = openDatabase();
    seedFixtures(db);
    const rule = createCollectionRule(profile, await boundedJson(request), db);
    return Response.json({ rule }, { status: 201, headers: privateHeaders });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}
