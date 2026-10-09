import type { LoaderFunctionArgs } from "react-router";
import { readAgentWorkerStatus } from "../.server/agent-worker.server";
import { scheduleErrorResponse } from "../.server/agent-schedule-http.server";
import { openDatabase, seedFixtures } from "../.server/db.server";
import { privateHeaders } from "../.server/file-content.server";
import { resolveDemoProfile } from "../.server/profile-session.server";

export function loader({ request }: LoaderFunctionArgs) {
  try {
    resolveDemoProfile(request);
    const db = openDatabase();
    seedFixtures(db);
    return Response.json({ worker: readAgentWorkerStatus(db) }, { headers: privateHeaders });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}
