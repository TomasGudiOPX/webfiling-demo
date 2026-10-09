import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addMockedUpload,
  getPublicFile,
  getProject,
  listFindings,
  listProjectFiles,
  openDatabase,
  resetDemoFixtures,
  reviewFile,
  seedFixtures,
  upsertIndexedFile,
} from "../app/.server/db.server";
import { assertAllowedSourceRoot, getConfig } from "../app/.server/config";
import { scenarioRegistry } from "../app/scenarios";
import type { ScenarioFileFixture } from "../app/types";

// @ts-expect-error Fixture categories are restricted to the shared vocabulary.
const unsupportedFixtureCategory: ScenarioFileFixture["categoryId"] = "unsupported";
void unsupportedFixtureCategory;

test("source allowlist rejects paths outside configured root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-root-"));
  assert.equal(assertAllowedSourceRoot(root, root), root);
  assert.throws(
    () => assertAllowedSourceRoot(path.dirname(root), root),
    /outside/,
  );
});

test("managed storage cannot overlap source or public roots", () => {
  const originalSourceRoot = process.env.SOURCE_ROOT;
  const originalManagedStorageRoot = process.env.MANAGED_STORAGE_ROOT;
  process.env.SOURCE_ROOT = "fixtures";
  process.env.MANAGED_STORAGE_ROOT = "fixtures";
  assert.throws(() => getConfig(), /MANAGED_STORAGE_ROOT/);
  if (originalManagedStorageRoot === undefined)
    delete process.env.MANAGED_STORAGE_ROOT;
  else process.env.MANAGED_STORAGE_ROOT = originalManagedStorageRoot;
  if (originalSourceRoot === undefined) delete process.env.SOURCE_ROOT;
  else process.env.SOURCE_ROOT = originalSourceRoot;
});

test("schema creation is idempotent", () => {
  process.env.DEMO_MODE = "true";
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-db-")),
    "demo.sqlite",
  );
  const first = openDatabase(file);
  first.exec("SELECT 1");
  const second = openDatabase(file);
  second.exec("SELECT 1");
  assert.ok(second);
});

test("library backfill seeds fixed grants without duplicating shared files or uploads", () => {
  const db = openDatabase(
    path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-library-backfill-")),
      "demo.sqlite",
    ),
  );
  seedFixtures(db);
  const collectionRows = db
    .prepare("SELECT id,kind,project_id FROM collections ORDER BY id")
    .all();
  const grantRows = db
    .prepare("SELECT profile_id,collection_id,can_read,can_contribute,can_organize FROM collection_grants ORDER BY profile_id,collection_id")
    .all();
  const profileRows = db
    .prepare("SELECT id,is_system_administrator FROM demo_profiles ORDER BY id")
    .all();
  const initialCounts = {
    collections: collectionRows.length,
    grants: grantRows.length,
    metadata: Number(
      (db.prepare("SELECT COUNT(*) AS count FROM library_file_metadata").get() as {
        count: number;
      }).count,
    ),
    projectLinks: Number(
      (db.prepare("SELECT COUNT(*) AS count FROM file_projects").get() as {
        count: number;
      }).count,
    ),
  };

  assert.deepEqual(profileRows.map((profile: any) => ({ ...profile })), [
    { id: "administration-staff", is_system_administrator: 0 },
    { id: "employee", is_system_administrator: 0 },
    { id: "manager", is_system_administrator: 0 },
    { id: "system-administrator", is_system_administrator: 1 },
  ]);
  assert.ok(
    collectionRows.some(
      (collection: any) =>
        collection.id === "collection-shared-resources" &&
        collection.kind === "shared" &&
        collection.project_id === null,
    ),
  );
  assert.ok(
    collectionRows.some(
      (collection: any) =>
        collection.id === "collection-administration" &&
        collection.kind === "administration" &&
        collection.project_id === null,
    ),
  );
  assert.deepEqual(
    {
      ...grantRows.find(
        (grant: any) =>
        grant.profile_id === "employee" &&
        grant.collection_id === "collection-project-project-costa-norte",
      ),
    },
    {
      profile_id: "employee",
      collection_id: "collection-project-project-costa-norte",
      can_read: 1,
      can_contribute: 1,
      can_organize: 0,
    },
  );

  const timestamp = "2026-10-08T00:00:00.000Z";
  db.prepare(
    "INSERT INTO files (id,project_id,stable_identity,filename,source_path,modified_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    "shared-standard",
    null,
    "managed:shared-standard",
    "Estándar compartido.md",
    "",
    timestamp,
    "pending_review",
    timestamp,
    timestamp,
  );
  db.prepare(
    "INSERT INTO library_file_metadata (file_id,collection_id,origin,content_key,display_name,availability,sample_owned,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    "shared-standard",
    "collection-shared-resources",
    "managed_upload",
    "objects/shared-standard",
    "Estándar compartido",
    "available",
    0,
    timestamp,
    timestamp,
  );
  for (const projectId of [
    "project-costa-norte",
    "project-parque-industrial",
  ])
    db.prepare(
      "INSERT INTO file_projects (file_id,project_id,created_at) VALUES (?,?,?)",
    ).run("shared-standard", projectId, timestamp);

  seedFixtures(db);
  assert.deepEqual(
    {
      collections: Number(
        (db.prepare("SELECT COUNT(*) AS count FROM collections").get() as {
          count: number;
        }).count,
      ),
      grants: Number(
        (db.prepare("SELECT COUNT(*) AS count FROM collection_grants").get() as {
          count: number;
        }).count,
      ),
    },
    { collections: initialCounts.collections, grants: initialCounts.grants },
  );
  assert.equal(
    Number(
      (db.prepare("SELECT COUNT(*) AS count FROM files WHERE id='shared-standard'").get() as {
        count: number;
      }).count,
    ),
    1,
  );
  assert.equal(
    Number(
      (db.prepare("SELECT COUNT(*) AS count FROM file_projects WHERE file_id='shared-standard'").get() as {
        count: number;
      }).count,
    ),
    2,
  );
  assert.equal(
    (db.prepare("SELECT sample_owned FROM library_file_metadata WHERE file_id='shared-standard'").get() as {
      sample_owned: number;
    }).sample_owned,
    0,
  );
});

test("public file facts omit legacy approval data and retain origin, organization, and versions", () => {
  const db = openDatabase(
    path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-public-file-")),
      "demo.sqlite",
    ),
  );
  seedFixtures(db);
  const current = getPublicFile("costa-plan-current", db)!;
  assert.equal(current.origin, "fixture");
  assert.equal(current.availability, "available");
  assert.equal(current.organization.categoryId, "technical");
  assert.deepEqual(current.versions.supersedes, ["costa-plan-old"]);
  assert.equal("status" in current, false);
  assert.equal("reviewer" in current, false);
  assert.equal("reviewedAt" in current, false);
  const older = getPublicFile("costa-plan-old", db)!;
  assert.equal(older.id, "costa-plan-old");
  assert.deepEqual(older.versions.supersededBy, ["costa-plan-current"]);

  const project = getProject("costa-norte", db)!;
  const unavailable = addMockedUpload(project.id, "pendiente.pdf", db);
  seedFixtures(db);
  const publicUnavailable = getPublicFile(unavailable.id, db)!;
  assert.equal(publicUnavailable.origin, "legacy_simulated");
  assert.equal(publicUnavailable.availability, "unavailable");
  assert.deepEqual(publicUnavailable.versions, {
    supersedes: [],
    supersededBy: [],
  });
});

test("organization migration preserves existing file and review history", () => {
  process.env.DEMO_MODE = "true";
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-organization-migration-")),
    "demo.sqlite",
  );
  let db = openDatabase(file);
  seedFixtures(db);
  reviewFile("parque-duplicate-a", "approve", "migration-reviewer", undefined, db);
  const snapshot = () => {
    const target = listProjectFiles(getProject("parque-industrial", db)!.id, db)
      .find((document) => document.id === "parque-duplicate-a")!;
    return {
      id: target.id,
      sourcePath: target.sourcePath,
      status: target.status,
      categoryId: target.categoryId,
      tags: target.tags,
      relations: db.prepare(
        "SELECT from_file_id,to_file_id,relation FROM file_relations WHERE from_file_id=? OR to_file_id=? ORDER BY from_file_id,to_file_id,relation",
      ).all(target.id, target.id),
      reviews: db.prepare("SELECT * FROM reviews WHERE file_id=? ORDER BY id")
        .all(target.id),
      findings: listFindings(target.projectId, db),
      events: db.prepare("SELECT * FROM decision_events WHERE file_id=? ORDER BY id")
        .all(target.id),
    };
  };
  const before = snapshot();
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
  db.exec(`CREATE TABLE files_legacy (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
    stable_identity TEXT NOT NULL UNIQUE, filename TEXT NOT NULL,
    source_path TEXT NOT NULL, extension TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL DEFAULT 0, modified_at TEXT NOT NULL,
    document_type TEXT NOT NULL DEFAULT 'other', status TEXT NOT NULL,
    index_state TEXT NOT NULL DEFAULT 'indexed', metadata_text TEXT NOT NULL DEFAULT '',
    reviewer TEXT, reviewed_at TEXT, review_reason TEXT, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, demo_owned INTEGER NOT NULL DEFAULT 0,
    preview_kind TEXT, preview_title TEXT, preview_url TEXT, preview_content TEXT,
    preview_sections TEXT, category_id TEXT, discipline_tag TEXT, location_tag TEXT
  )`);
  db.exec("INSERT INTO files_legacy SELECT * FROM files; DROP TABLE files; ALTER TABLE files_legacy RENAME TO files; CREATE INDEX idx_files_project_status ON files(project_id,status); CREATE INDEX idx_files_identity ON files(stable_identity); COMMIT; PRAGMA foreign_keys=ON");
  db.close();

  db = openDatabase(file);
  seedFixtures(db);
  const fileColumns = db.prepare("PRAGMA table_info(files)").all() as Array<{ name: string; notnull: number }>;
  assert.equal(fileColumns.find((column) => column.name === "project_id")?.notnull, 0);
  const fileIndexes = db.prepare("PRAGMA index_list(files)").all() as Array<{ name: string }>;
  assert.ok(fileIndexes.some((index) => index.name === "idx_files_project_status"));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.prepare(`INSERT INTO files (
    id,project_id,stable_identity,filename,source_path,modified_at,status,created_at,updated_at
  ) VALUES ('shared-unassigned',NULL,'managed:shared-unassigned','Standard.md','',?, 'pending_review', ?, ?)`)
    .run("2026-10-08T00:00:00.000Z", "2026-10-08T00:00:00.000Z", "2026-10-08T00:00:00.000Z");
  assert.equal(db.prepare("SELECT project_id FROM files WHERE id='shared-unassigned'").get()?.project_id, null);
  const afterFirstInitialization = snapshot();
  openDatabase(file).close();
  db.close();
  db = openDatabase(file);
  seedFixtures(db);
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(afterFirstInitialization, before);
  db.close();
});

test("scenario registry keeps stable and distinct demo stories", () => {
  assert.equal(scenarioRegistry.length, 4);
  assert.deepEqual(
    scenarioRegistry.map((scenario) => scenario.slug),
    ["costa-norte", "parque-industrial", "torre-del-parque", "torre-horizonte"],
  );
  assert.equal(
    new Set(scenarioRegistry.map((scenario) => scenario.dominantIssue)).size,
    4,
  );
  assert.ok(
    scenarioRegistry.every(
      (scenario) => scenario.files.length > 0 && scenario.relations.length > 0,
    ),
  );
});

test("scenario fixtures include unclassified and cross-category tag examples", () => {
  const files = scenarioRegistry.flatMap((scenario) => scenario.files);
  assert.ok(files.some((file) => file.categoryId === null));
  const structureCategories = new Set(
    files
      .filter((file) => file.tags.discipline === "structures")
      .map((file) => file.categoryId),
  );
  assert.ok(structureCategories.size > 1);
});

test("fixture reset restores statuses, findings, and excludes mocked uploads", () => {
  process.env.DEMO_MODE = "true";
  const db = openDatabase(
    path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-scenarios-")),
      "demo.sqlite",
    ),
  );
  seedFixtures(db);
  const parque = getProject("parque-industrial", db);
  assert.ok(parque);
  assert.equal(listProjectFiles(parque.id, db).length, 4);
  assert.equal(listFindings(parque.id, db).length, 3);
  reviewFile("parque-duplicate-a", "approve", "test-reviewer", undefined, db);
  addMockedUpload(parque.id, "entrada-simulada.pdf", db);
  assert.ok(
    listProjectFiles(parque.id, db).some(
      (file) => file.status === "pending_ingestion",
    ),
  );
  resetDemoFixtures(db);
  const restored = listProjectFiles(parque.id, db);
  assert.equal(restored.length, 4);
  assert.ok(
    restored.every((file) => !file.filename.includes("entrada-simulada")),
  );
  assert.equal(
    restored.find((file) => file.id === "parque-duplicate-a")?.status,
    "pending_review",
  );
  assert.equal(
    restored.find((file) => file.id === "parque-memoria")?.categoryId,
    "technical",
  );
  assert.equal(
    listProjectFiles(parque.id, db).find((file) => file.id === "parque-memoria")?.tags
      .discipline,
    "structures",
  );
  assert.equal(
    listFindings(parque.id, db).filter((finding) => finding.state !== "open")
      .length,
    0,
  );
});

test("fixture reset preserves non-demo children and their source files", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-reset-boundary-"));
  const db = openDatabase(path.join(temp, "demo.sqlite"));
  seedFixtures(db);
  const project = getProject("parque-industrial", db)!;
  const sourcePath = path.join(temp, "real-child.pdf");
  fs.writeFileSync(sourcePath, "source remains unchanged");
  db.prepare(
    "INSERT INTO files (id,project_id,stable_identity,filename,source_path,extension,size_bytes,modified_at,document_type,status,index_state,metadata_text,created_at,updated_at,demo_owned) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)",
  ).run(
    "real-child",
    project.id,
    sourcePath,
    "real-child.pdf",
    sourcePath,
    ".pdf",
    24,
    "2026-10-08T00:00:00.000Z",
    "other",
    "pending_review",
    "indexed",
    "real child",
    "2026-10-08T00:00:00.000Z",
    "2026-10-08T00:00:00.000Z",
  );
  db.prepare(
    "INSERT INTO reviews (file_id,reviewer,decision,reason,reviewed_at,classification_snapshot) VALUES (?,?,?,?,?,?)",
  ).run("real-child", "real-reviewer", "return", "review retained", "2026-10-08T00:00:00.000Z", "{}");
  db.prepare(
    "INSERT INTO findings (id,file_id,type,reason,evidence,confidence,state,demo_owned) VALUES (?,?,?,?,?,?,?,0)",
  ).run("real-finding", "real-child", "missing_metadata", "retained", "evidence", 0.5, "open");
  db.prepare(
    "INSERT INTO review_items (id,project_id,file_id,target_kind,target_id,state,severity,priority,due_at,created_at,updated_at,demo_owned) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)",
  ).run("real-review-item", project.id, "real-child", "file_classification", "real-child", "assigned", "normal", "normal", "2026-10-10T00:00:00.000Z", "2026-10-08T00:00:00.000Z", "2026-10-08T00:00:00.000Z");
  db.prepare(
    "INSERT INTO decision_events (id,review_item_id,file_id,entity_type,entity_id,event_type,actor_id,actor_name,occurred_at,context_json,demo_owned) VALUES (?,?,?,?,?,?,?,?,?,?,0)",
  ).run("real-event", "real-review-item", "real-child", "file_classification", "real-child", "indexed", "real-indexer", "Indexer", "2026-10-08T00:00:00.000Z", "{}");

  resetDemoFixtures(db);

  assert.equal(getProject("parque-industrial", db)?.id, project.id);
  const child = listProjectFiles(project.id, db).find((file) => file.id === "real-child");
  assert.equal(child?.sourcePath, sourcePath);
  assert.equal(child?.categoryId, null);
  assert.equal(fs.readFileSync(sourcePath, "utf8"), "source remains unchanged");
  for (const table of ["reviews", "findings", "review_items", "decision_events"])
    assert.equal(
      Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${table === "reviews" ? "file_id='real-child'" : table === "findings" ? "id='real-finding'" : table === "review_items" ? "id='real-review-item'" : "id='real-event'"}`).get() as { count: number }).count),
      1,
      `${table} for the non-demo child should remain`,
    );
  assert.ok(listProjectFiles(project.id, db).some((file) => file.id === "parque-memoria"));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("fixture metadata backfill is targeted and indexing keeps organization", () => {
  const db = openDatabase(
    path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-organization-backfill-")),
      "demo.sqlite",
    ),
  );
  seedFixtures(db);
  reviewFile("costa-notice", "return", "test-reviewer", "Needs revision", db);
  const before = db
    .prepare("SELECT status,reviewer,reviewed_at,review_reason FROM files WHERE id=?")
    .get("costa-notice");
  const reviewCount = Number(
    (db.prepare("SELECT COUNT(*) AS count FROM reviews WHERE file_id=?")
      .get("costa-notice") as { count: number }).count,
  );
  const eventCount = Number(
    (db.prepare("SELECT COUNT(*) AS count FROM decision_events WHERE file_id=?")
      .get("costa-notice") as { count: number }).count,
  );
  db.prepare(
    "UPDATE files SET category_id=NULL,discipline_tag=NULL,location_tag=NULL WHERE id='th-matriz'",
  ).run();
  const project = getProject("torre-horizonte", db)!;
  upsertIndexedFile(
    {
      projectId: project.id,
      sourcePath: "C:/real-source/unclassified.pdf",
      filename: "unclassified.pdf",
      extension: ".pdf",
      sizeBytes: 10,
      modifiedAt: "2026-10-08T00:00:00.000Z",
      documentType: "other",
    },
    db,
  );
  const unclassified = listProjectFiles(project.id, db).find(
    (document) => document.filename === "unclassified.pdf",
  )!;
  assert.equal(unclassified.categoryId, null);
  assert.deepEqual(unclassified.tags, { discipline: null, location: null });
  db.prepare(
    "UPDATE files SET category_id='logistics',discipline_tag='logistics' WHERE source_path='C:/real-source/unclassified.pdf'",
  ).run();
  upsertIndexedFile(
    {
      projectId: project.id,
      sourcePath: "C:/real-source/unclassified.pdf",
      filename: "unclassified.pdf",
      extension: ".pdf",
      sizeBytes: 20,
      modifiedAt: "2026-10-08T01:00:00.000Z",
      documentType: "other",
    },
    db,
  );

  seedFixtures(db);
  const files = listProjectFiles(project.id, db);
  const curated = files.find((file) => file.id === "th-matriz")!;
  const indexed = files.find((file) => file.filename === "unclassified.pdf")!;
  assert.equal(curated.categoryId, "technical");
  assert.equal(curated.tags.discipline, "structures");
  assert.equal(curated.sizeBytes, 11200);
  assert.equal(indexed.categoryId, "logistics");
  assert.deepEqual(indexed.tags, { discipline: "logistics", location: null });
  assert.deepEqual(
    db.prepare("SELECT status,reviewer,reviewed_at,review_reason FROM files WHERE id=?")
      .get("costa-notice"),
    before,
  );
  assert.equal(
    Number((db.prepare("SELECT COUNT(*) AS count FROM reviews WHERE file_id=?")
      .get("costa-notice") as { count: number }).count),
    reviewCount,
  );
  assert.equal(
    Number((db.prepare("SELECT COUNT(*) AS count FROM decision_events WHERE file_id=?")
      .get("costa-notice") as { count: number }).count),
    eventCount,
  );
});

test("indexed files infer preview support from their extension", () => {
  const db = openDatabase(
    path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-previews-")),
      "demo.sqlite",
    ),
  );
  seedFixtures(db);
  const project = getProject("costa-norte", db)!;
  const expected = new Map([
    ["evidence.jpg", "image"],
    ["scope.md", "markdown"],
    ["spec.docx", "docx"],
    ["plan.pdf", "pdf"],
  ]);
  for (const [filename, kind] of expected) {
    upsertIndexedFile(
      {
        projectId: project.id,
        sourcePath: `C:/source/${filename}`,
        filename,
        extension: path.extname(filename),
        sizeBytes: 1,
        modifiedAt: "2026-10-08T00:00:00.000Z",
        documentType: "other",
      },
      db,
    );
    assert.equal(
      listProjectFiles(project.id, db).find(
        (file) => file.filename === filename,
      )?.preview?.kind,
      kind,
    );
  }
});

test("demo DOCX evidence has a readable fallback when its source is not mounted", () => {
  const db = openDatabase(
    path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-docx-")),
      "demo.sqlite",
    ),
  );
  seedFixtures(db);
  const project = getProject("costa-norte", db)!;
  const docx = listProjectFiles(project.id, db).find(
    (file) => file.id === "costa-notice",
  );
  assert.equal(docx?.preview?.kind, "docx");
  assert.match(docx?.preview?.content ?? "", /canaleta técnica/);
});
