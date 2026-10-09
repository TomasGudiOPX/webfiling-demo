import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase, seedFixtures } from "../app/.server/db.server";
import {
  ScheduleServiceError,
  controlAgentSchedule,
  createAgentSchedule,
  getAgentSchedule,
  listAgentSchedules,
  updateAgentSchedule,
} from "../app/.server/agent-schedules.server";
import { action as createScheduleAction } from "../app/routes/api.agent.schedules";
import { getConfig } from "../app/.server/config";

function setup() {
  const databasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-schedules-")), "demo.sqlite");
  process.env.DATABASE_PATH = databasePath;
  process.env.DEMO_MODE = "true";
  process.env.SESSION_SECRET = "schedule-tests";
  const db = openDatabase(databasePath);
  seedFixtures(db);
  return { db, databasePath };
}

const fixedNow = new Date("2026-10-08T12:00:00.000Z");
const recurring = {
  actionType: "collection_check",
  collectionId: "collection-project-project-costa-norte",
  scheduleKind: "recurring",
  timezone: "America/Argentina/Buenos_Aires",
  cronExpression: "0 9 * * 1",
};

test("schedule CRUD is system-administrator-only and preserves versions/manual run invariants", () => {
  const { db } = setup();
  assert.throws(() => createAgentSchedule("employee", recurring, db, fixedNow), (error: unknown) => error instanceof ScheduleServiceError && error.status === 403);
  const created = createAgentSchedule("system-administrator", recurring, db, fixedNow);
  assert.equal(created.ownerProfileId, "system-administrator");
  assert.ok(created.nextRunAt);
  assert.equal(listAgentSchedules("system-administrator", db).length, 1);
  assert.equal(listAgentSchedules("manager", db).length, 0);
  assert.throws(() => getAgentSchedule("employee", String(created.id), db), (error: unknown) =>
    error instanceof ScheduleServiceError && error.status === 404,
  );
  assert.throws(() => createAgentSchedule("employee", { ...recurring, actorId: "manager" }, db, fixedNow), ScheduleServiceError);

  assert.throws(() => updateAgentSchedule("manager", String(created.id), { ...recurring, version: created.version }, db, fixedNow), (error: unknown) => error instanceof ScheduleServiceError && error.status === 403);
  const updated = updateAgentSchedule("system-administrator", String(created.id), { ...recurring, version: created.version }, db, fixedNow);
  assert.equal(updated.version, 2);
  assert.throws(() => updateAgentSchedule("employee", String(created.id), { ...recurring, version: 1 }, db, fixedNow), (error: unknown) =>
    error instanceof ScheduleServiceError && error.status === 403,
  );
  assert.throws(() => controlAgentSchedule("employee", String(created.id), { intent: "pause", version: 2 }, db, fixedNow), (error: unknown) => error instanceof ScheduleServiceError && error.status === 403);
  const paused = controlAgentSchedule("system-administrator", String(created.id), { intent: "pause", version: 2 }, db, fixedNow);
  assert.ok("pausedAt" in paused);
  assert.ok(paused.pausedAt);
  const manual = controlAgentSchedule("system-administrator", String(created.id), { intent: "run_now", version: paused.version, requestId: "click-1" }, db, fixedNow);
  assert.ok("status" in manual);
  assert.equal(manual.status, "queued");
  assert.equal(manual.nextRunAt, created.nextRunAt);
  const deduplicated = controlAgentSchedule("system-administrator", String(created.id), { intent: "run_now", version: paused.version, requestId: "click-1" }, db, fixedNow);
  assert.ok("status" in deduplicated);
  assert.equal(deduplicated.id, manual.id);
  const resumed = controlAgentSchedule("system-administrator", String(created.id), { intent: "resume", version: paused.version }, db, new Date("2026-10-13T12:00:00.000Z"));
  assert.ok("pausedAt" in resumed);
  assert.equal(resumed.pausedAt, null);
  assert.ok(String(resumed.nextRunAt) > String(created.nextRunAt));

  db.prepare("UPDATE collection_grants SET can_read=0,can_contribute=0,can_organize=0 WHERE profile_id='employee' AND collection_id=?").run(recurring.collectionId);
  assert.throws(() => getAgentSchedule("employee", String(created.id), db), (error: unknown) =>
    error instanceof ScheduleServiceError && error.status === 404,
  );
  db.close();
});

test("schedule creation route enforces same-origin and uses the signed profile context", async () => {
  const { databasePath } = setup();
  const makeRequest = (origin?: string) => new Request("http://example.test/api/agent/schedules", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
      Cookie: `webfiling_demo_profile=system-administrator.${createHmac("sha256", getConfig().sessionSecret).update("system-administrator").digest("base64url")}`,
    },
    body: JSON.stringify(recurring),
  });
  const invoke = (request: Request) => createScheduleAction({ request, params: {}, context: {} } as never);
  const denied = await invoke(makeRequest());
  assert.equal(denied.status, 403);
  const accepted = await invoke(makeRequest("http://example.test"));
  assert.equal(accepted.status, 201);
  assert.match(accepted.headers.get("Cache-Control") ?? "", /no-store/);
  const db = openDatabase(databasePath);
  const schedule = db.prepare("SELECT owner_profile_id FROM agent_schedules").get() as { owner_profile_id: string };
  assert.equal(schedule.owner_profile_id, "system-administrator");
  db.close();
});

test("one-off schedules require future instants and the per-profile quota is bounded", () => {
  const { db } = setup();
  assert.throws(() => createAgentSchedule("system-administrator", {
    actionType: "collection_summary", collectionId: recurring.collectionId, scheduleKind: "once",
    timezone: "UTC", runAt: "2026-10-08T11:59:59.000Z",
  }, db, fixedNow), ScheduleServiceError);
  for (let index = 0; index < 20; index++)
    createAgentSchedule("system-administrator", { ...recurring, collectionId: recurring.collectionId }, db, fixedNow);
  assert.throws(() => createAgentSchedule("system-administrator", recurring, db, fixedNow), (error: unknown) =>
    error instanceof ScheduleServiceError && error.status === 409,
  );
  db.close();
});

test("legacy schedules are visible to admin for audited adoption and remain paused", () => {
  const { db } = setup();
  const created = createAgentSchedule("system-administrator", recurring, db, fixedNow);
  db.prepare("UPDATE agent_schedules SET owner_profile_id='manager',managing_profile_id=NULL,management_blocked=1,paused_at=?,version=version+1 WHERE id=?")
    .run(fixedNow.toISOString(), created.id);
  const blocked = listAgentSchedules("system-administrator", db).find((schedule) => schedule.id === created.id)!;
  assert.equal(blocked.managementBlocked, true);
  assert.throws(() => controlAgentSchedule("manager", created.id, { intent: "adopt", version: blocked.version }, db, fixedNow), (error: unknown) => error instanceof ScheduleServiceError && error.status === 403);
  const adopted = controlAgentSchedule("system-administrator", created.id, { intent: "adopt", version: blocked.version }, db, fixedNow);
  assert.ok("managementBlocked" in adopted);
  assert.equal(adopted.managementBlocked, false);
  assert.equal(adopted.managingProfileId, "system-administrator");
  assert.ok(adopted.pausedAt);
  assert.equal((db.prepare("SELECT event_type FROM agent_schedule_events WHERE schedule_id=?").get(created.id) as { event_type: string }).event_type, "adopted");
  assert.throws(() => controlAgentSchedule("system-administrator", created.id, { intent: "adopt", version: adopted.version }, db, fixedNow), (error: unknown) => error instanceof ScheduleServiceError && error.status === 409);
  db.close();
});
