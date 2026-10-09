import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectionCapabilities,
  fileCapabilities,
} from "../app/.server/file-access.server";
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
