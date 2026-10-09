import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase, seedFixtures } from "../app/.server/db.server";
import { createAgentSchedule, type AgentScheduleDTO } from "../app/.server/agent-schedules.server";
import { controlAgentSchedule } from "../app/.server/agent-schedules.server";
import { claimDueScheduledRun, completeScheduledRun, materializeDueScheduledRuns, readAgentWorkerStatus, renewScheduledRunLease, writeAgentWorkerHeartbeat } from "../app/.server/agent-worker.server";

test("scheduled occurrences have stable identity and leases fence competing or stale workers", () => {
  const databasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-worker-")), "demo.sqlite");
  process.env.DATABASE_PATH = databasePath;
  process.env.DEMO_MODE = "true";
  process.env.SESSION_SECRET = "worker-tests";
  const db = openDatabase(databasePath);
  seedFixtures(db);
  const created = createAgentSchedule("system-administrator", {
    actionType: "collection_check", collectionId: "collection-project-project-costa-norte",
    scheduleKind: "recurring", timezone: "UTC", cronExpression: "*/15 * * * 1-5",
  }, db, new Date("2026-10-09T00:00:00.000Z"));
  db.prepare("UPDATE agent_schedules SET next_run_at='2026-10-09T00:15:00.000Z' WHERE id=?").run(created.id);
  const now = new Date("2026-10-09T00:16:00.000Z");
  assert.equal(materializeDueScheduledRuns(db, now), 1);
  assert.equal(materializeDueScheduledRuns(db, now), 0);
  const first = claimDueScheduledRun("worker-a", db, now, 5_000);
  assert.ok(first);
  assert.equal(claimDueScheduledRun("worker-b", db, now, 5_000), null);
  const reclaimedAt = new Date(now.getTime() + 6_000);
  const second = claimDueScheduledRun("worker-b", db, reclaimedAt, 5_000);
  assert.ok(second);
  assert.equal(second.id, first.id);
  assert.equal(second.effectKey, first.effectKey);
  assert.equal(second.attempt, first.attempt + 1);
  assert.equal(completeScheduledRun("worker-a", first.id, first.attempt, { ok: true }, db, reclaimedAt), false);
  assert.equal(renewScheduledRunLease("worker-b", second.id, second.attempt, db, new Date(reclaimedAt.getTime() + 1_000), 5_000), true);
  assert.equal(completeScheduledRun("worker-b", second.id, second.attempt, { ok: true }, db, new Date(reclaimedAt.getTime() + 2_000)), true);
  assert.equal((db.prepare("SELECT status,attempt_count FROM scheduled_runs WHERE id=?").get(first.id) as { status: string; attempt_count: number }).status, "succeeded");
  assert.equal((db.prepare("SELECT count(*) AS count FROM scheduled_runs WHERE schedule_id=? AND occurrence_key=?").get(created.id, first.occurrenceKey) as { count: number }).count, 1);
  assert.equal(claimDueScheduledRun("worker-c", db, new Date(reclaimedAt.getTime() + 10_000), 5_000), null);
  db.close();
});

test("90-day schedule gaps coalesce to one bounded occurrence and pause fences in-flight work", () => {
  const databasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-worker-recovery-")), "demo.sqlite");
  process.env.DATABASE_PATH = databasePath;
  process.env.DEMO_MODE = "true";
  process.env.SESSION_SECRET = "worker-tests";
  const db = openDatabase(databasePath);
  seedFixtures(db);
  const created = createAgentSchedule("system-administrator", {
    actionType: "collection_check", collectionId: "collection-project-project-costa-norte",
    scheduleKind: "recurring", timezone: "UTC", cronExpression: "*/15 * * * 1-5",
  }, db, new Date("2026-10-09T00:00:00.000Z"));
  db.prepare("UPDATE agent_schedules SET next_run_at='2026-01-01T00:00:00.000Z' WHERE id=?").run(created.id);
  const now = new Date("2026-10-09T12:00:00.000Z");
  assert.equal(materializeDueScheduledRuns(db, now, 1), 1);
  const row = db.prepare("SELECT id,occurrence_key FROM scheduled_runs WHERE schedule_id=?").get(created.id) as { id: string; occurrence_key: string };
  assert.match(row.occurrence_key, /^cron:coalesced:/);
  const claim = claimDueScheduledRun("pause-worker", db, now, 5_000)!;
  const paused = controlAgentSchedule("system-administrator", created.id, { intent: "pause", version: created.version }, db, now) as AgentScheduleDTO;
  assert.ok(paused.pausedAt);
  assert.equal((db.prepare("SELECT status FROM scheduled_runs WHERE id=?").get(claim.id) as { status: string }).status, "skipped");
  assert.equal(completeScheduledRun("pause-worker", claim.id, claim.attempt, { ok: true }, db, new Date(now.getTime() + 1_000)), false);
  const resumed = controlAgentSchedule("system-administrator", created.id, { intent: "resume", version: paused.version }, db, new Date(now.getTime() + 90 * 60_000)) as AgentScheduleDTO;
  assert.ok(resumed.nextRunAt && new Date(resumed.nextRunAt).getTime() > now.getTime() + 90 * 60_000);
  assert.equal(materializeDueScheduledRuns(db, new Date(now.getTime() + 90 * 60_000), 1), 0);
  db.close();
});

test("worker heartbeat reports stale and unavailable automation safely", () => {
  const databasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-worker-heartbeat-")), "demo.sqlite");
  process.env.DATABASE_PATH = databasePath;
  process.env.DEMO_MODE = "true";
  const db = openDatabase(databasePath);
  seedFixtures(db);
  const now = new Date("2026-10-09T12:00:00.000Z");
  writeAgentWorkerHeartbeat("agent-test", "running", db, now, null, now.toISOString());
  assert.equal(readAgentWorkerStatus(db, now).stale, false);
  assert.deepEqual(readAgentWorkerStatus(db, new Date(now.getTime() + 46_000)), {
    status: "stale", stale: true, heartbeatAt: now.toISOString(), lastSuccessAt: now.toISOString(),
  });
  process.env.DEMO_MODE = "false";
  assert.equal(readAgentWorkerStatus(db, now).status, "unavailable");
  db.close();
});
