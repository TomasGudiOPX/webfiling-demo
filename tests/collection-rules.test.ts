import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase, seedFixtures } from "../app/.server/db.server";
import {
  RuleInputError,
  createCollectionRule,
  getCollectionRule,
  listCollectionRules,
  setCollectionRuleState,
  updateCollectionRule,
} from "../app/.server/collection-rules.server";

const collectionId = "collection-project-project-costa-norte";
const now = new Date("2026-10-08T12:00:00.000Z");
function setup() {
  const db = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-rules-")), "demo.sqlite"));
  seedFixtures(db);
  return db;
}
function definition(extra: Record<string, unknown> = {}) {
  return {
    slots: [{
      key: "monthly-report", label: "Informe mensual", requiredCount: 1, allowedExtensions: [".pdf", ".docx"],
      criteria: { filenameIncludes: "informe", categoryId: "finance" },
    }],
    organizationDefaults: { categoryId: "finance", disciplineTag: "finance" },
    recurrence: { kind: "monthly", timezone: "UTC", day: 1, hour: 9, minute: 0, windowMinutes: 1440 },
    ...extra,
  };
}
function input(extra: Record<string, unknown> = {}) {
  return { recipientProfileId: "employee", collectionId, projectId: "project-costa-norte", definition: definition(), ...extra };
}

test("validated rules keep immutable versions and record enable/edit/archive transitions", () => {
  const db = setup();
  const folder = db.prepare("INSERT INTO managed_folders (id,collection_id,parent_id,display_name,created_at,updated_at) VALUES ('reports',?,NULL,'Informes',?,?)").run(collectionId, now.toISOString(), now.toISOString());
  assert.ok(folder);
  const first = createCollectionRule("system-administrator", input({ definition: definition({ organizationDefaults: { categoryId: "finance", disciplineTag: "finance", folderId: "reports" } }) }), db, now);
  assert.equal(first.enabled, false);
  assert.equal(first.version, 1);
  assert.equal(first.recipientProfileId, "employee");
  setCollectionRuleState("system-administrator", first.id, "enable", 1, db, now);
  const editedDefinition = definition({ slots: [{
    key: "monthly-report", label: "Informe del mes", requiredCount: 2, allowedExtensions: ["pdf"],
    criteria: { filenameIncludes: "informe", categoryId: "finance" },
  }] });
  const second = updateCollectionRule("system-administrator", first.id, { version: 1, projectId: "project-costa-norte", definition: editedDefinition }, db, new Date("2026-10-09T12:00:00.000Z"));
  assert.equal(second.version, 2);
  assert.equal(second.enabled, true);
  const oldVersion = db.prepare("SELECT definition_json FROM collection_rule_versions WHERE rule_id=? AND version=1").get(first.id) as { definition_json: string };
  assert.equal(JSON.parse(oldVersion.definition_json).slots[0].requiredCount, 1);
  assert.equal(getCollectionRule("employee", first.id, db).version, 2);
  assert.equal(listCollectionRules("employee", db).length, 1);
  setCollectionRuleState("system-administrator", first.id, "archive", 2, db, now);
  assert.equal(listCollectionRules("employee", db).length, 0);
  assert.equal((db.prepare("SELECT count(*) AS count FROM collection_rule_events WHERE rule_id=?").get(first.id) as { count: number }).count, 4);
  db.close();
});

test("only system administrators configure rules; recipient contribution and destination scope still apply", () => {
  const db = setup();
  for (const profile of ["employee", "manager", "administration-staff"] as const) assert.throws(() => createCollectionRule(profile, input({ recipientProfileId: profile }), db, now), (error: unknown) =>
    error instanceof RuleInputError && error.status === 403,
  );
  assert.throws(() => createCollectionRule("system-administrator", input({ collectionId: "collection-administration" }), db, now), (error: unknown) =>
    error instanceof RuleInputError && error.status === 404,
  );
  assert.throws(() => createCollectionRule("system-administrator", input({ projectId: "project-parque-industrial" }), db, now), (error: unknown) =>
    error instanceof RuleInputError && error.status === 404,
  );
  db.prepare("UPDATE collection_grants SET can_contribute=0 WHERE profile_id='employee' AND collection_id=?").run(collectionId);
  assert.throws(() => createCollectionRule("system-administrator", input(), db, now), (error: unknown) => error instanceof RuleInputError && error.status === 404);
  db.close();
});

test("legacy non-admin rule adoption is audited, preserves creator and requires current recipient contribution", () => {
  const db = setup();
  const created = createCollectionRule("system-administrator", input(), db, now);
  db.prepare("UPDATE collection_rules SET creator_profile_id='manager',managing_profile_id=NULL,management_blocked=1,enabled=1 WHERE id=?").run(created.id);
  assert.equal(listCollectionRules("system-administrator", db).find((rule) => rule.id === created.id)?.managementBlocked, true);
  assert.throws(() => setCollectionRuleState("manager", created.id, "adopt", 1, db, now), (error: unknown) => error instanceof RuleInputError && error.status === 403);
  db.prepare("UPDATE collection_grants SET can_contribute=0 WHERE profile_id='employee' AND collection_id=?").run(collectionId);
  assert.throws(() => setCollectionRuleState("system-administrator", created.id, "adopt", 1, db, now), (error: unknown) => error instanceof RuleInputError && error.status === 404);
  db.prepare("UPDATE collection_grants SET can_contribute=1 WHERE profile_id='employee' AND collection_id=?").run(collectionId);
  const adopted = setCollectionRuleState("system-administrator", created.id, "adopt", 1, db, now);
  assert.equal(adopted.creatorProfileId, "manager");
  assert.equal(adopted.managingProfileId, "system-administrator");
  assert.equal(adopted.managementBlocked, false);
  assert.equal((db.prepare("SELECT event_type FROM collection_rule_events WHERE rule_id=? ORDER BY rowid DESC LIMIT 1").get(created.id) as { event_type: string }).event_type, "adopted");
  db.close();
});

test("rule validation rejects contradictory defaults, unsupported selectors, unbounded slots, and actor fields", () => {
  const db = setup();
  const invalidDefinitions = [
    definition({ organizationDefaults: { categoryId: "technical" } }),
    definition({ slots: [{ key: "bad", label: "Informe", requiredCount: 1, allowedExtensions: [".exe"], criteria: {} }] }),
    definition({ slots: Array.from({ length: 11 }, (_, index) => ({ key: `slot-${index}`, label: "slot", requiredCount: 1, allowedExtensions: [".pdf"], criteria: {} })) }),
  ];
  for (const value of invalidDefinitions)
    assert.throws(() => createCollectionRule("system-administrator", input({ definition: value }), db, now), RuleInputError);
  assert.throws(() => createCollectionRule("system-administrator", input({ actorId: "employee" }), db, now), RuleInputError);
  const oneOff = createCollectionRule("system-administrator", input({ definition: definition({
    recurrence: { kind: "one_off", timezone: "UTC", opensAt: "2026-11-01T09:00:00Z", closesAt: "2026-11-02T09:00:00Z" },
  }) }), db, now);
  assert.equal(oneOff.version, 1);
  db.close();
});
