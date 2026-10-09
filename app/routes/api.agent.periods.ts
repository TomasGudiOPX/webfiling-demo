import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { cancelCollectionPeriod, listCollectionPeriods } from "../.server/collection-periods.server";
import { boundedJson, scheduleErrorResponse } from "../.server/agent-schedule-http.server";
import { openDatabase, seedFixtures } from "../.server/db.server";
import { privateHeaders } from "../.server/file-content.server";
import { assertSameOrigin, resolveDemoProfile } from "../.server/profile-session.server";

export function loader({ request }: LoaderFunctionArgs) {
  try {
    const profile = resolveDemoProfile(request);
    const collectionId = new URL(request.url).searchParams.get("collectionId") ?? "";
    const db = openDatabase();
    seedFixtures(db);
    return Response.json({ periods: listCollectionPeriods(profile, collectionId, db) }, { headers: privateHeaders });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    if (request.method !== "POST") return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: privateHeaders });
    const profile = resolveDemoProfile(request);
    assertSameOrigin(request);
    const body = await boundedJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as Record<string, unknown>).periodId !== "string" || typeof (body as Record<string, unknown>).reason !== "string")
      return Response.json({ error: { code: "invalid" } }, { status: 400, headers: privateHeaders });
    const value = body as { periodId: string; reason: string };
    const db = openDatabase();
    seedFixtures(db);
    return Response.json({ period: cancelCollectionPeriod(profile, value.periodId, value.reason, db) }, { headers: privateHeaders });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}
