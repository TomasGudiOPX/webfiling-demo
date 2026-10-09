import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase, seedFixtures } from "../app/.server/db.server";
import { createAgentSchedule } from "../app/.server/agent-schedules.server";
import { claimDueScheduledRun, executeClaimedScheduledRun, materializeDueScheduledRuns } from "../app/.server/agent-worker.server";
import { executeScheduledCollectionSummary } from "../app/.server/agent-plans.server";
import { saveManagedUpload } from "../app/.server/managed-upload.server";
import { createCollectionRule, setCollectionRuleState } from "../app/.server/collection-rules.server";

const collectionId = "collection-project-project-costa-norte";
const dueAt = new Date("2026-10-09T12:00:00.000Z");
async function setup(actionType: "collection_check" | "collection_summary" = "collection_summary") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "webfiling-worker-exec-"));
  process.env.DATABASE_PATH = path.join(root, "demo.sqlite");
  process.env.MANAGED_STORAGE_ROOT = path.join(root, "managed");
  process.env.SOURCE_ROOT = path.join(root, "source");
  process.env.DEMO_MODE = "true";
  process.env.SESSION_SECRET = "worker-tests";
  await fs.mkdir(process.env.SOURCE_ROOT);
  const db = openDatabase(process.env.DATABASE_PATH);
  seedFixtures(db);
  await saveManagedUpload("manager", { collectionId, file: new File(["Revisión de avance. El frente norte sigue activo."], "avance.txt", { type: "text/plain" }) }, db);
  const schedule = createAgentSchedule("system-administrator", {
    actionType, collectionId, scheduleKind: "recurring", timezone: "UTC", cronExpression: "0 12 * * 1-5",
  }, db, new Date("2026-10-09T11:00:00.000Z"));
  db.prepare("UPDATE agent_schedules SET next_run_at=? WHERE id=?").run(dueAt.toISOString(), schedule.id);
  return { root, db, schedule };
}

test("scheduled summary executes allowlisted work and recovery reuses its stable agent effect", async () => {
  const { root, db, schedule } = await setup();
  assert.equal(materializeDueScheduledRuns(db, dueAt), 1);
  const first = claimDueScheduledRun("worker-a", db, dueAt, 5_000)!;
  await executeScheduledCollectionSummary("system-administrator", collectionId, first.effectKey, db, dueAt);
  const summaryCount = (db.prepare("SELECT count(*) AS count FROM agent_summaries").get() as { count: number }).count;
  const retryAt = new Date(dueAt.getTime() + 6_000);
  const retry = claimDueScheduledRun("worker-b", db, retryAt, 5_000)!;
  const result = await executeClaimedScheduledRun("worker-b", retry, db, retryAt);
  assert.equal(result.status, "succeeded");
  assert.equal((db.prepare("SELECT count(*) AS count FROM agent_summaries").get() as { count: number }).count, summaryCount);
  const runRow = db.prepare("SELECT result_json FROM scheduled_runs WHERE id=?").get(first.id) as { result_json: string };
  assert.equal(runRow.result_json.includes("Revisión de avance"), false);
  assert.equal((db.prepare("SELECT count(*) AS count FROM agent_runs WHERE request_key=?").get(`scheduled:${first.effectKey}`) as { count: number }).count, 1);
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});

test("collection checks materialize only enabled periods and reconcile within their authorized collection", async () => {
  const { root, db, schedule } = await setup("collection_check");
  const opensAt = new Date(dueAt.getTime() - 60 * 60_000);
  const rule = createCollectionRule("system-administrator", {
    recipientProfileId: "employee", collectionId, projectId: "project-costa-norte",
    definition: {
      slots: [{ key: "report", label: "Informe", requiredCount: 1, allowedExtensions: [".txt"], criteria: {} }],
      organizationDefaults: {}, recurrence: { kind: "one_off", timezone: "UTC", opensAt: opensAt.toISOString(), closesAt: dueAt.toISOString() },
    },
  }, db, new Date("2026-10-09T11:00:00.000Z"));
  setCollectionRuleState("system-administrator", rule.id, "enable", rule.version, db, new Date("2026-10-09T11:00:00.000Z"));
  materializeDueScheduledRuns(db, dueAt);
  const claim = claimDueScheduledRun("worker-check", db, dueAt, 5_000)!;
  const result = await executeClaimedScheduledRun("worker-check", claim, db, dueAt);
  assert.equal(result.status, "succeeded");
  assert.equal((db.prepare("SELECT count(*) AS count FROM collection_periods WHERE rule_id=?").get(rule.id) as { count: number }).count, 1);
  assert.ok(schedule.id);
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});

test("transient scheduled failures retry at most three times and permission loss blocks execution", async () => {
  const { root, db, schedule } = await setup();
  db.exec("CREATE TRIGGER reject_agent_summaries BEFORE INSERT ON agent_summaries BEGIN SELECT RAISE(ABORT,'injected transient error'); END");
  materializeDueScheduledRuns(db, dueAt);
  let at = dueAt;
  let claim = claimDueScheduledRun("worker-a", db, at, 5_000)!;
  assert.equal((await executeClaimedScheduledRun("worker-a", claim, db, at)).status, "retry_scheduled");
  at = new Date(dueAt.getTime() + 31_000);
  claim = claimDueScheduledRun("worker-a", db, at, 5_000)!;
  assert.equal((await executeClaimedScheduledRun("worker-a", claim, db, at)).status, "retry_scheduled");
  at = new Date(dueAt.getTime() + 152_000);
  claim = claimDueScheduledRun("worker-a", db, at, 5_000)!;
  assert.equal((await executeClaimedScheduledRun("worker-a", claim, db, at)).status, "failed");
  assert.equal((db.prepare("SELECT attempt_count FROM scheduled_runs WHERE id=?").get(claim.id) as { attempt_count: number }).attempt_count, 3);
  db.exec("DROP TRIGGER reject_agent_summaries");

  const checkSchedule = createAgentSchedule("system-administrator", {
    actionType: "collection_check", collectionId, scheduleKind: "recurring", timezone: "UTC", cronExpression: "0 12 * * 1-5",
  }, db, new Date("2026-10-09T11:00:00.000Z"));
  db.prepare("UPDATE agent_schedules SET next_run_at=? WHERE id=?").run(dueAt.toISOString(), checkSchedule.id);
  materializeDueScheduledRuns(db, dueAt);
  const blockedClaim = claimDueScheduledRun("worker-b", db, dueAt, 5_000)!;
  db.prepare("UPDATE collection_grants SET can_read=0,can_contribute=0,can_organize=0 WHERE profile_id='system-administrator' AND collection_id=?").run(collectionId);
  const blocked = await executeClaimedScheduledRun("worker-b", blockedClaim, db, dueAt);
  assert.deepEqual(blocked, { status: "blocked", errorCode: "permission_changed" });
  assert.ok(schedule.id);
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});
