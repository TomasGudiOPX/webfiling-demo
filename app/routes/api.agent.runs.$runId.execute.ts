import type { ActionFunctionArgs } from "react-router";
import { executeAgentOrganizationStep, executeAgentRuleDraftStep, executeAgentSummaryStep, AgentPlanError } from "../.server/agent-plans.server";
import { parseDemoAgentOperation } from "../.server/agent-safety.server";
import { boundedJson, scheduleErrorResponse } from "../.server/agent-schedule-http.server";
import { openDatabase, seedFixtures } from "../.server/db.server";
import { privateHeaders } from "../.server/file-content.server";
import { listCollectionPeriods } from "../.server/collection-periods.server";
import { transaction } from "../.server/sqlite-transaction.server";
import { assertSameOrigin, resolveDemoProfile } from "../.server/profile-session.server";

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    if (request.method !== "POST") return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: privateHeaders });
    assertSameOrigin(request);
    const profileId = resolveDemoProfile(request);
    const input = await boundedJson(request) as Record<string, unknown>;
    if (Object.keys(input).length) throw new AgentPlanError("invalid_operation", 400);
    const db = openDatabase();
    seedFixtures(db);
    const runId = params.runId ?? "";
    const run = db.prepare("SELECT profile_id,intent FROM agent_runs WHERE id=?").get(runId) as { profile_id: string; intent: string } | undefined;
    if (!run || run.profile_id !== profileId) throw new AgentPlanError("not_found", 404);
    const operation = parseDemoAgentOperation(JSON.parse(run.intent));
    if (operation.type === "organize") return Response.json({ result: executeAgentOrganizationStep(profileId, runId, "apply", db) }, { headers: privateHeaders });
    if (operation.type === "draft_rule") return Response.json({ result: executeAgentRuleDraftStep(profileId, runId, "apply", db) }, { headers: privateHeaders });
    if (operation.type === "summarize" || operation.type === "summarize_collection")
      return Response.json({ result: await executeAgentSummaryStep(profileId, runId, "apply", db) }, { headers: privateHeaders });
    if (operation.type === "check_collection") {
      const periods = listCollectionPeriods(profileId, operation.collectionId, db);
      const result = transaction(db, () => {
        const at = new Date().toISOString();
        const summary = { outcome: "succeeded", visiblePeriods: periods.length, missing: periods.filter((period) => ["pending", "partial", "overdue"].includes(period.status)).length };
        db.prepare("UPDATE agent_steps SET state='succeeded',result_json=?,updated_at=? WHERE run_id=? AND step_key='apply' AND state IN ('queued','running')")
          .run(JSON.stringify(summary), at, runId);
        db.prepare("UPDATE agent_runs SET status='completed',finished_at=? WHERE id=?").run(at, runId);
        return summary;
      });
      return Response.json({ result }, { headers: privateHeaders });
    }
    throw new AgentPlanError("unsupported_action", 501);
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}
