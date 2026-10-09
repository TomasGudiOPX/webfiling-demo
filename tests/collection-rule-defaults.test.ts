import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase, seedFixtures } from "../app/.server/db.server";
import { createCollectionRule, setCollectionRuleState } from "../app/.server/collection-rules.server";
import { saveManagedUpload } from "../app/.server/managed-upload.server";

const collectionId = "collection-project-project-costa-norte";
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "webfiling-rule-defaults-"));
  process.env.DATABASE_PATH = path.join(root, "demo.sqlite");
  process.env.MANAGED_STORAGE_ROOT = path.join(root, "managed");
  process.env.SOURCE_ROOT = path.join(root, "source");
  process.env.DEMO_MODE = "true";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  await fs.mkdir(process.env.SOURCE_ROOT);
  const db = openDatabase(process.env.DATABASE_PATH);
  seedFixtures(db);
  return { root, db };
}
function createRule(db: ReturnType<typeof openDatabase>, categoryId: string, startDay: number, enabled: boolean) {
  const opensAt = new Date(Date.UTC(2027, 0, startDay, 9));
  const rule = createCollectionRule("system-administrator", {
    recipientProfileId: "employee", collectionId, projectId: "project-costa-norte",
    definition: {
      slots: [{ key: "report", label: "Informe", requiredCount: 1, allowedExtensions: [".txt"], criteria: { filenameIncludes: "informe", categoryId } }],
      organizationDefaults: { categoryId },
      recurrence: { kind: "one_off", timezone: "UTC", opensAt: opensAt.toISOString(), closesAt: new Date(opensAt.getTime() + 60 * 60_000).toISOString() },
    },
  }, db, new Date("2026-10-09T12:00:00.000Z"));
  if (enabled) setCollectionRuleState("system-administrator", rule.id, "enable", rule.version, db, new Date("2026-10-09T12:00:00.000Z"));
  return rule;
}

test("matching new uploads apply a single current rule default with provenance; conflicts and disabled rules fail closed", async () => {
  const { root, db } = await setup();
  const finance = createRule(db, "finance", 1, true);
  const upload = await saveManagedUpload("employee", {
    collectionId, file: new File(["contenido"], "informe-finanzas.txt", { type: "text/plain" }), projectIds: ["project-costa-norte"],
  }, db);
  assert.equal(upload.organizationDefaults.status, "applied");
  assert.equal((db.prepare("SELECT category_id FROM files WHERE id=?").get(upload.id) as { category_id: string }).category_id, "finance");
  const appliedEvent = db.prepare("SELECT after_json FROM file_events WHERE file_id=? AND event_type='metadata_changed'").get(upload.id) as { after_json: string };
  assert.deepEqual(JSON.parse(appliedEvent.after_json).authorization, { kind: "collection_rule", ruleId: finance.id, version: 1 });

  const technical = createRule(db, "technical", 2, true);
  const conflict = await saveManagedUpload("employee", {
    collectionId, file: new File(["contenido dos"], "informe-tecnico.txt", { type: "text/plain" }), projectIds: ["project-costa-norte"],
  }, db);
  assert.equal(conflict.organizationDefaults.status, "conflict");
  assert.equal((db.prepare("SELECT category_id FROM files WHERE id=?").get(conflict.id) as { category_id: string | null }).category_id, null);
  assert.ok(db.prepare("SELECT 1 FROM file_events WHERE file_id=? AND event_type='organization_defaults_skipped'").get(conflict.id));

  setCollectionRuleState("system-administrator", finance.id, "pause", finance.version, db, new Date("2026-10-09T12:00:00.000Z"));
  setCollectionRuleState("system-administrator", technical.id, "pause", technical.version, db, new Date("2026-10-09T12:00:00.000Z"));
  const disabled = createRule(db, "logistics", 3, false);
  const noMatch = await saveManagedUpload("employee", {
    collectionId, file: new File(["contenido tres"], "informe-logistica.txt", { type: "text/plain" }), projectIds: ["project-costa-norte"],
  }, db);
  assert.equal(noMatch.organizationDefaults.status, "none");
  assert.ok(disabled.id);
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});
