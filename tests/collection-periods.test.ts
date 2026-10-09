import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase, seedFixtures } from "../app/.server/db.server";
import { createCollectionRule, setCollectionRuleState, updateCollectionRule } from "../app/.server/collection-rules.server";
import {
  CollectionPeriodError,
  cancelCollectionPeriod,
  evaluateCollectionPeriod,
  listCollectionPeriods,
  materializeRulePeriods,
} from "../app/.server/collection-periods.server";

const collectionId = "collection-project-project-costa-norte";
const now = new Date("2026-10-08T12:00:00.000Z");
function setup() {
  const databasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-periods-")), "demo.sqlite");
  const db = openDatabase(databasePath);
  seedFixtures(db);
  return { db, databasePath };
}
function createRule(db: ReturnType<typeof openDatabase>, recurrence: Record<string, unknown>, slots = [
  { key: "report", label: "Informe", requiredCount: 1, allowedExtensions: [".pdf"], criteria: {} },
  { key: "photos", label: "Fotos", requiredCount: 1, allowedExtensions: [".jpg"], criteria: {} },
]) {
  const rule = createCollectionRule("system-administrator", {
    recipientProfileId: "employee", collectionId, projectId: "project-costa-norte",
    definition: { slots, organizationDefaults: {}, recurrence },
  }, db, now);
  setCollectionRuleState("system-administrator", rule.id, "enable", rule.version, db, now);
  return rule;
}
function addFile(db: ReturnType<typeof openDatabase>, id: string, at: string) {
  db.prepare("INSERT INTO files (id,project_id,stable_identity,filename,source_path,modified_at,status,created_at,updated_at) VALUES (?,? ,?,?, '',?,'pending_review',?,?)")
    .run(id, "project-costa-norte", `managed:${id}`, `${id}.pdf`, at, at, at);
  db.prepare("INSERT INTO library_file_metadata (file_id,collection_id,origin,display_name,contributor_id,availability,sample_owned,created_at,updated_at) VALUES (?,?, 'managed_upload',?,'employee','available',0,?,?)")
    .run(id, collectionId, `${id}.pdf`, at, at);
}

test("period materialization is idempotent and lifecycle status follows fixed time and evidence", () => {
  const { db, databasePath } = setup();
  const rule = createRule(db, {
    kind: "one_off", timezone: "UTC", opensAt: "2026-10-10T09:00:00.000Z", closesAt: "2026-10-11T09:00:00.000Z",
  });
  assert.equal(materializeRulePeriods(rule.id, now, db), 1);
  assert.equal(materializeRulePeriods(rule.id, now, db), 0);
  const periodId = (db.prepare("SELECT id FROM collection_periods WHERE rule_id=?").get(rule.id) as { id: string }).id;
  assert.equal(evaluateCollectionPeriod(periodId, new Date("2026-10-10T08:59:59.999Z"), db).status, "upcoming");
  assert.equal(evaluateCollectionPeriod(periodId, new Date("2026-10-10T09:00:00.000Z"), db).status, "pending");
  addFile(db, "report-upload", "2026-10-11T09:00:00.000Z");
  db.prepare("INSERT INTO collection_evidence (id,period_id,slot_key,file_id,contributor_profile_id,uploaded_at,linked_at,linked_by) VALUES ('evidence-report',?,'report','report-upload','employee','2026-10-11T09:00:00.000Z',?,'employee')")
    .run(periodId, "2026-10-11T09:00:00.000Z");
  const partial = evaluateCollectionPeriod(periodId, new Date("2026-10-11T09:00:00.000Z"), db);
  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.missing, [{ slotKey: "photos", count: 1 }]);
  assert.equal(evaluateCollectionPeriod(periodId, new Date("2026-10-11T09:00:00.001Z"), db).status, "overdue");
  addFile(db, "late-upload", "2026-10-11T09:01:00.000Z");
  db.prepare("INSERT INTO collection_evidence (id,period_id,slot_key,file_id,contributor_profile_id,uploaded_at,linked_at,linked_by,is_late) VALUES ('evidence-late',?,'photos','late-upload','employee','2026-10-11T09:01:00.000Z',?,'employee',1)")
    .run(periodId, "2026-10-11T09:02:00.000Z");
  assert.equal(evaluateCollectionPeriod(periodId, new Date("2026-10-11T09:02:00.000Z"), db).status, "received_late");
  assert.equal(listCollectionPeriods("employee", collectionId, db, new Date("2026-10-11T09:02:00.000Z")).length, 1);
  assert.equal(listCollectionPeriods("administration-staff", collectionId, db).length, 0);
  assert.ok((db.prepare("SELECT count(*) AS count FROM collection_events WHERE period_id=? AND event_type='status_changed'").get(periodId) as { count: number }).count >= 4);
  db.close();
  const restarted = openDatabase(databasePath);
  assert.equal((restarted.prepare("SELECT status FROM collection_periods WHERE id=?").get(periodId) as { status: string }).status, "received_late");
  assert.deepEqual(restarted.prepare("PRAGMA foreign_key_check").all(), []);
  restarted.close();
});

test("editing supersedes only unopened snapshots; pause/resume and cancellation are recorded", () => {
  const { db, databasePath } = setup();
  const rule = createRule(db, { kind: "monthly", timezone: "UTC", day: 1, hour: 9, minute: 0, windowMinutes: 1440 });
  assert.equal(materializeRulePeriods(rule.id, now, db), 3);
  const changed = updateCollectionRule("system-administrator", rule.id, {
    version: 1, projectId: "project-costa-norte",
    definition: {
      slots: [{ key: "report", label: "Informe", requiredCount: 2, allowedExtensions: [".pdf"], criteria: {} }],
      organizationDefaults: {}, recurrence: { kind: "monthly", timezone: "UTC", day: 1, hour: 9, minute: 0, windowMinutes: 1440 },
    },
  }, db, now);
  assert.equal(changed.version, 2);
  const createdAfterEdit = materializeRulePeriods(rule.id, now, db);
  assert.equal(createdAfterEdit, 3);
  const periods = listCollectionPeriods("employee", collectionId, db, now);
  assert.equal(periods.filter((period) => period.superseded).length, 3);
  assert.equal(periods.filter((period) => period.ruleVersion === 2).length, 3);
  setCollectionRuleState("system-administrator", rule.id, "pause", 2, db, now);
  assert.equal(materializeRulePeriods(rule.id, new Date("2027-02-01T00:00:00Z"), db), 0);
  setCollectionRuleState("system-administrator", rule.id, "resume", 2, db, new Date("2027-02-01T00:00:00Z"));
  assert.equal(materializeRulePeriods(rule.id, new Date("2027-02-01T00:00:00Z"), db), 4);
  const latest = db.prepare("SELECT id FROM collection_periods WHERE rule_id=? AND rule_version=2 AND superseded_at IS NULL ORDER BY opens_at DESC LIMIT 1").get(rule.id) as { id: string };
  const cancelled = cancelCollectionPeriod("system-administrator", latest.id, "No se necesita este período", db, new Date("2027-02-01T00:01:00Z"));
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancellationReason, "No se necesita este período");
  assert.throws(() => cancelCollectionPeriod("employee", latest.id, "no", db), (error: unknown) =>
    error instanceof CollectionPeriodError && error.status === 404,
  );
  assert.equal((db.prepare("SELECT count(*) AS count FROM collection_events WHERE period_id=? AND event_type='cancelled'").get(latest.id) as { count: number }).count, 1);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
  const restarted = openDatabase(databasePath);
  assert.ok((restarted.prepare("SELECT 1 FROM collection_events WHERE period_id=? AND event_type='cancelled'").get(latest.id)));
  restarted.close();
});
