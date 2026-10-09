import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase, seedFixtures } from "../app/.server/db.server";
import { createCollectionRule, setCollectionRuleState } from "../app/.server/collection-rules.server";
import { evaluateCollectionPeriod, materializeRulePeriods } from "../app/.server/collection-periods.server";
import { matchManagedUploadEvidence, replayRecentUploadEvidence } from "../app/.server/collection-evidence.server";
import { saveManagedUpload } from "../app/.server/managed-upload.server";
import { editLibraryFile, setTrashed } from "../app/.server/library-management.server";

const collectionId = "collection-project-project-costa-norte";
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "webfiling-evidence-"));
  process.env.DATABASE_PATH = path.join(root, "demo.sqlite");
  process.env.MANAGED_STORAGE_ROOT = path.join(root, "managed");
  process.env.SOURCE_ROOT = path.join(root, "source");
  process.env.DEMO_MODE = "true";
  process.env.SESSION_SECRET = "evidence-tests";
  await fs.mkdir(process.env.SOURCE_ROOT);
  const db = openDatabase(process.env.DATABASE_PATH);
  seedFixtures(db);
  return { root, db };
}
const uploadFile = (name = "informe.txt") => new File(["contenido real"], name, { type: "text/plain" });
function rule(db: ReturnType<typeof openDatabase>, open: Date, close: Date, slots: Array<Record<string, unknown>>, projectId: string | null = "project-costa-norte") {
  const created = createCollectionRule("system-administrator", {
    recipientProfileId: "employee", collectionId, projectId,
    definition: {
      slots, organizationDefaults: {},
      recurrence: { kind: "one_off", timezone: "UTC", opensAt: open.toISOString(), closesAt: close.toISOString() },
    },
  }, db, new Date(open.getTime() - 60_000));
  setCollectionRuleState("system-administrator", created.id, "enable", created.version, db, new Date(open.getTime() - 60_000));
  return created;
}

test("ordinary managed uploads match server identity, scope, criteria, and explicit ambiguities", async () => {
  const { root, db } = await setup();
  const now = new Date();
  const opens = new Date(now.getTime() - 60 * 60_000);
  const closes = new Date(now.getTime() + 60 * 60_000);
  const created = rule(db, opens, closes, [
    { key: "report", label: "Informe", requiredCount: 1, allowedExtensions: [".txt"], criteria: { filenameIncludes: "informe" } },
    { key: "memo", label: "Nota", requiredCount: 1, allowedExtensions: [".txt"], criteria: {} },
  ]);
  assert.equal(materializeRulePeriods(created.id, now, db), 1);
  const periodId = (db.prepare("SELECT id FROM collection_periods WHERE rule_id=?").get(created.id) as { id: string }).id;
  const employeeUpload = await saveManagedUpload("employee", {
    collectionId, file: uploadFile(), projectIds: ["project-costa-norte"],
  }, db);
  const ambiguous = matchManagedUploadEvidence("employee", employeeUpload.id, undefined, db, now);
  assert.equal(ambiguous.status, "ambiguous");
  if (ambiguous.status !== "ambiguous") throw new Error("expected ambiguous slot choices");
  assert.deepEqual(ambiguous.choices.map((choice) => choice.slotKey), ["report", "memo"]);
  assert.equal((db.prepare("SELECT count(*) AS count FROM collection_evidence WHERE file_id=?").get(employeeUpload.id) as { count: number }).count, 0);
  const linked = matchManagedUploadEvidence("employee", employeeUpload.id, { periodId, slotKey: "report" }, db, now);
  assert.deepEqual(linked, { status: "linked", periodId, slotKey: "report", late: false });
  assert.equal(matchManagedUploadEvidence("employee", employeeUpload.id, undefined, db, now).status, "already_linked");
  const evidence = db.prepare("SELECT contributor_profile_id,uploaded_at FROM collection_evidence WHERE file_id=?").get(employeeUpload.id) as { contributor_profile_id: string; uploaded_at: string };
  const uploadEvent = db.prepare("SELECT actor_id,occurred_at FROM file_events WHERE file_id=? AND event_type='uploaded'").get(employeeUpload.id) as { actor_id: string; occurred_at: string };
  assert.equal(evidence.contributor_profile_id, "employee");
  assert.equal(evidence.uploaded_at, uploadEvent.occurred_at);
  assert.equal(uploadEvent.actor_id, "employee");

  const otherProfileUpload = await saveManagedUpload("manager", {
    collectionId, file: uploadFile("informe-manager.txt"), projectIds: ["project-costa-norte"],
  }, db);
  assert.deepEqual(matchManagedUploadEvidence("manager", otherProfileUpload.id, undefined, db, now), { status: "not_matched" });
  const fixtureId = (db.prepare("SELECT file_id FROM library_file_metadata WHERE collection_id=? AND origin='fixture' LIMIT 1").get(collectionId) as { file_id: string }).file_id;
  assert.deepEqual(matchManagedUploadEvidence("employee", fixtureId, undefined, db, now), { status: "not_matched" });
  const fakeId = "no-upload-event";
  db.prepare("INSERT INTO files (id,project_id,stable_identity,filename,source_path,modified_at,status,created_at,updated_at) VALUES (?,? ,?,?, '',?,'pending_review',?,?)")
    .run(fakeId, "project-costa-norte", `managed:${fakeId}`, "informe-fake.txt", now.toISOString(), now.toISOString(), now.toISOString());
  db.prepare("INSERT INTO library_file_metadata (file_id,collection_id,origin,display_name,contributor_id,availability,sample_owned,created_at,updated_at) VALUES (?,?, 'managed_upload',?,'employee','available',0,?,?)")
    .run(fakeId, collectionId, "informe-fake.txt", now.toISOString(), now.toISOString());
  assert.deepEqual(matchManagedUploadEvidence("employee", fakeId, undefined, db, now), { status: "not_matched" });
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});

test("late fulfillment requires explicit overdue-period and slot selection", async () => {
  const { root, db } = await setup();
  const beforeUpload = new Date();
  const file = await saveManagedUpload("employee", { collectionId, file: uploadFile(), projectIds: ["project-costa-norte"] }, db);
  const uploadedAt = (db.prepare("SELECT occurred_at FROM file_events WHERE file_id=? AND event_type='uploaded'").get(file.id) as { occurred_at: string }).occurred_at;
  const closes = new Date(new Date(uploadedAt).getTime() - 1_000);
  const opens = new Date(closes.getTime() - 60 * 60_000);
  const created = rule(db, opens, closes, [
    { key: "report", label: "Informe", requiredCount: 1, allowedExtensions: [".txt"], criteria: {} },
  ]);
  assert.equal(materializeRulePeriods(created.id, beforeUpload, db), 1);
  const periodId = (db.prepare("SELECT id FROM collection_periods WHERE rule_id=?").get(created.id) as { id: string }).id;
  const requiresChoice = matchManagedUploadEvidence("employee", file.id, undefined, db, beforeUpload);
  assert.equal(requiresChoice.status, "ambiguous");
  assert.equal((db.prepare("SELECT count(*) AS count FROM collection_evidence WHERE file_id=?").get(file.id) as { count: number }).count, 0);
  const linked = matchManagedUploadEvidence("employee", file.id, { periodId, slotKey: "report" }, db, beforeUpload);
  assert.deepEqual(linked, { status: "linked", periodId, slotKey: "report", late: true });
  assert.equal(evaluateCollectionPeriod(periodId, new Date(), db).status, "received_late");
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});

test("upload evidence reconciles through trash, restore, project edits, and replay", async () => {
  const { root, db } = await setup();
  const now = new Date();
  const created = rule(db, new Date(now.getTime() - 60 * 60_000), new Date(now.getTime() + 60 * 60_000), [
    { key: "report", label: "Informe", requiredCount: 1, allowedExtensions: [".txt"], criteria: {} },
  ]);
  assert.equal(materializeRulePeriods(created.id, now, db), 1);
  const periodId = (db.prepare("SELECT id FROM collection_periods WHERE rule_id=?").get(created.id) as { id: string }).id;
  const uploaded = await saveManagedUpload("employee", {
    collectionId, file: uploadFile(), projectIds: ["project-costa-norte"],
  }, db);
  assert.deepEqual(uploaded.evidence, { status: "linked", periodId, slotKey: "report", late: false });
  assert.equal(evaluateCollectionPeriod(periodId, now, db).status, "received");
  assert.equal((db.prepare("SELECT count(*) AS count FROM collection_evidence WHERE file_id=?").get(uploaded.id) as { count: number }).count, 1);

  setTrashed("employee", uploaded.id, true, db);
  assert.equal((db.prepare("SELECT active FROM collection_evidence WHERE file_id=?").get(uploaded.id) as { active: number }).active, 0);
  assert.equal(evaluateCollectionPeriod(periodId, now, db).status, "pending");
  setTrashed("employee", uploaded.id, false, db);
  assert.equal((db.prepare("SELECT active FROM collection_evidence WHERE file_id=?").get(uploaded.id) as { active: number }).active, 1);

  editLibraryFile("employee", uploaded.id, { projectIds: [] }, db);
  assert.equal((db.prepare("SELECT active FROM collection_evidence WHERE file_id=?").get(uploaded.id) as { active: number }).active, 0);
  editLibraryFile("employee", uploaded.id, { projectIds: ["project-costa-norte"] }, db);
  assert.equal((db.prepare("SELECT active FROM collection_evidence WHERE file_id=?").get(uploaded.id) as { active: number }).active, 1);
  assert.equal((db.prepare("SELECT count(*) AS count FROM collection_evidence WHERE file_id=?").get(uploaded.id) as { count: number }).count, 1);

  db.prepare("DELETE FROM collection_evidence WHERE file_id=?").run(uploaded.id);
  assert.equal(replayRecentUploadEvidence(db, now).length, 1);
  assert.equal((db.prepare("SELECT active FROM collection_evidence WHERE file_id=?").get(uploaded.id) as { active: number }).active, 1);
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});
