import type { ActionFunctionArgs } from "react-router";
import { nextCronOccurrences, validateCronSchedule } from "../.server/schedule-cron.server";
import { boundedJson, scheduleErrorResponse } from "../.server/agent-schedule-http.server";
import { privateHeaders } from "../.server/file-content.server";
import { assertSameOrigin, resolveDemoProfile } from "../.server/profile-session.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    if (request.method !== "POST") return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: privateHeaders });
    assertSameOrigin(request);
    resolveDemoProfile(request);
    const input = await boundedJson(request) as Record<string, unknown>;
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some((key) => !["cronExpression", "timezone"].includes(key)) ||
        typeof input.cronExpression !== "string" || typeof input.timezone !== "string") {
      return Response.json({ error: { code: "invalid_request", message: "La vista previa no es válida." } }, { status: 400, headers: privateHeaders });
    }
    const now = new Date();
    validateCronSchedule(input.cronExpression, input.timezone, now);
    const occurrences = nextCronOccurrences(input.cronExpression, input.timezone, now, 3);
    return Response.json({ occurrences: occurrences.map((date) => date.toISOString()) }, { headers: privateHeaders });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}
