import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectionCapabilities,
  fileCapabilities,
} from "../app/.server/file-access.server";
import {
  canManageAgentSchedule,
  canManageCollectionRule,
  canReadAgentRun,
  canReadCollectionPeriod,
} from "../app/.server/agent-access.server";
import { openDatabase, seedFixtures } from "../app/.server/db.server";

test("collection grants separate employee, manager, administration, and system roles", () => {
  const db = openDatabase(
    path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-file-access-")),
      "demo.sqlite",
    ),
  );
  seedFixtures(db);
  assert.deepEqual(
    collectionCapabilities(
      "employee",
      "collection-project-project-costa-norte",
      db,
    ),
    {
      canRead: true,
      canContribute: true,
      canOrganize: false,
      canResetSamples: false,
    },
  );
  assert.deepEqual(
    collectionCapabilities(
      "manager",
      "collection-project-project-costa-norte",
      db,
    ),
    {
      canRead: true,
      canContribute: true,
      canOrganize: true,
      canResetSamples: false,
    },
  );
  assert.deepEqual(
    collectionCapabilities(
      "administration-staff",
      "collection-administration",
      db,
    ),
    {
      canRead: true,
      canContribute: true,
      canOrganize: true,
      canResetSamples: false,
    },
  );
  assert.equal(
    collectionCapabilities(
      "administration-staff",
      "collection-project-project-costa-norte",
      db,
    ).canRead,
    false,
  );
  assert.equal(
    collectionCapabilities(
      "system-administrator",
      "collection-administration",
      db,
    ).canResetSamples,
    true,
  );
});

test("a contributor cannot edit another profile's managed upload", () => {
  const db = openDatabase(
    path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-file-owner-")),
      "demo.sqlite",
    ),
  );
  seedFixtures(db);
  const timestamp = "2026-10-08T00:00:00.000Z";
  db.prepare(
    "INSERT INTO files (id,project_id,stable_identity,filename,source_path,modified_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    "manager-upload",
    "project-costa-norte",
    "managed:manager-upload",
    "manager-upload.pdf",
    "",
    timestamp,
    "pending_review",
    timestamp,
    timestamp,
  );
  db.prepare(
    "INSERT INTO library_file_metadata (file_id,collection_id,origin,display_name,contributor_id,availability,sample_owned,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    "manager-upload",
    "collection-project-project-costa-norte",
    "managed_upload",
    "manager-upload.pdf",
    "manager",
    "available",
    0,
    timestamp,
    timestamp,
  );
  assert.deepEqual(fileCapabilities("employee", "manager-upload", db), {
    canRead: true,
    canContribute: true,
    canOrganize: false,
    canResetSamples: false,
    canEditOwnUpload: false,
    canEdit: false,
  });
  assert.equal(fileCapabilities("manager", "manager-upload", db)?.canEdit, true);
});

test("agent authority is private, recipient scoped, and rechecks current grants", () => {
  const db = openDatabase(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-agent-access-")), "demo.sqlite"),
  );
  seedFixtures(db);
  const timestamp = "2026-10-08T00:00:00.000Z";
  db.prepare(
    "INSERT INTO agent_runs (id,profile_id,provider_version,intent,status,created_at) VALUES ('employee-run','employee','demo-v1','summary','completed',?)",
  ).run(timestamp);
  assert.equal(canReadAgentRun("employee", "employee-run", db), true);
  assert.equal(canReadAgentRun("manager", "employee-run", db), false);
  assert.equal(canReadAgentRun("manager", "missing-run", db), false);

  db.prepare(
    "INSERT INTO collection_rules (id,creator_profile_id,recipient_profile_id,collection_id,current_version,created_at,updated_at) VALUES ('employee-rule','employee','employee','collection-project-project-costa-norte',1,?,?)",
  ).run(timestamp, timestamp);
  db.prepare(
    "INSERT INTO collection_rule_versions (rule_id,version,definition_json,timezone,created_by,created_at) VALUES ('employee-rule',1,'{}','America/Argentina/Buenos_Aires','employee',?)",
  ).run(timestamp);
  db.prepare(
    "INSERT INTO collection_periods (id,rule_id,rule_version,occurrence_key,recipient_profile_id,collection_id,opens_at,closes_at,timezone,status,created_at) VALUES ('employee-period','employee-rule',1,'one','employee','collection-project-project-costa-norte',?,?, 'America/Argentina/Buenos_Aires','pending',?)",
  ).run(timestamp, "2026-10-09T00:00:00.000Z", timestamp);
  assert.equal(canManageCollectionRule("employee", "employee-rule", db), false);
  assert.equal(canManageCollectionRule("manager", "employee-rule", db), false);
  assert.equal(canManageCollectionRule("system-administrator", "employee-rule", db), false);
  assert.equal(canManageCollectionRule("administration-staff", "employee-rule", db), false);
  assert.equal(canReadCollectionPeriod("employee", "employee-period", db), true);
  assert.equal(canReadCollectionPeriod("manager", "employee-period", db), true);
  assert.equal(canReadCollectionPeriod("administration-staff", "employee-period", db), false);

  db.prepare(
    "INSERT INTO agent_schedules (id,owner_profile_id,collection_id,action_type,timezone,cron_expression,created_at,updated_at) VALUES ('employee-schedule','employee','collection-project-project-costa-norte','collection_check','America/Argentina/Buenos_Aires','0 9 * * *',?,?)",
  ).run(timestamp, timestamp);
  assert.equal(canManageAgentSchedule("employee", "employee-schedule", db), false);
  assert.equal(canManageAgentSchedule("manager", "employee-schedule", db), false);
  assert.equal(canManageAgentSchedule("system-administrator", "employee-schedule", db), false);

  db.prepare(
    "UPDATE collection_grants SET can_contribute=0,can_organize=0,can_read=0 WHERE profile_id='employee' AND collection_id='collection-project-project-costa-norte'",
  ).run();
  assert.equal(canManageCollectionRule("employee", "employee-rule", db), false);
  assert.equal(canManageCollectionRule("manager", "employee-rule", db), false);
  assert.equal(canReadCollectionPeriod("employee", "employee-period", db), false);
  assert.equal(canManageAgentSchedule("employee", "employee-schedule", db), false);
  const previousDemoMode = process.env.DEMO_MODE;
  const previousSessionSecret = process.env.SESSION_SECRET;
  process.env.DEMO_MODE = "false";
  process.env.SESSION_SECRET = "test-session-secret";
  try {
    assert.equal(canReadAgentRun("employee", "employee-run", db), false);
    assert.equal(canManageCollectionRule("employee", "employee-rule", db), false);
    assert.equal(canReadCollectionPeriod("employee", "employee-period", db), false);
    assert.equal(canManageAgentSchedule("employee", "employee-schedule", db), false);
  } finally {
    if (previousDemoMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = previousDemoMode;
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;
  }
  db.close();
});

test("organizers cannot create recipient rules for a profile without current contribution access", () => {
  const db = openDatabase(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-agent-scope-")), "demo.sqlite"),
  );
  seedFixtures(db);
  const timestamp = "2026-10-08T00:00:00.000Z";
  db.prepare(
    "INSERT INTO collection_rules (id,creator_profile_id,recipient_profile_id,collection_id,current_version,created_at,updated_at) VALUES ('wrong-destination','manager','employee','collection-project-project-parque-industrial',1,?,?)",
  ).run(timestamp, timestamp);
  assert.equal(canManageCollectionRule("manager", "wrong-destination", db), false);
  db.close();
});
