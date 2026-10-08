import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addMockedUpload,
  getProject,
  openDatabase,
  resetDemoFixtures,
  reviewFile,
  seedFixtures,
  upsertIndexedFile,
} from "../app/.server/db.server";
import { reconstructAsOf } from "../app/.server/reconstruction.server";
import { decisionEventStatus } from "../app/types";

function fixtureDb() {
  return openDatabase(
    path.join(
      os.tmpdir(),
      `webfiling-reconstruction-${Date.now()}-${Math.random()}.sqlite`,
    ),
  );
}

function fileEvents(db: ReturnType<typeof openDatabase>, fileId: string) {
  return db
    .prepare(
      "SELECT * FROM decision_events WHERE entity_type='file_classification' AND entity_id=? ORDER BY occurred_at ASC, rowid ASC",
    )
    .all(fileId) as any[];
}

test("decision event type maps to its resulting file status", () => {
  assert.equal(decisionEventStatus("approve"), "approved");
  assert.equal(decisionEventStatus("return"), "returned");
  assert.equal(decisionEventStatus("superseded"), "superseded");
  assert.equal(
    decisionEventStatus("indexed", { after: { fileStatus: "missing_metadata" } }),
    "missing_metadata",
  );
});

test("legacy reviewFile writes one matching decision event with before/after", () => {
  const db = fixtureDb();
  seedFixtures(db);
  reviewFile("parque-duplicate-a", "approve", "test-reviewer", "Listo", db);
  const approves = db
    .prepare(
      "SELECT * FROM decision_events WHERE entity_type='file_classification' AND file_id=? AND event_type='approve'",
    )
    .all("parque-duplicate-a") as any[];
  assert.equal(approves.length, 1);
  const context = JSON.parse(approves[0].context_json);
  assert.equal(context.before.fileStatus, "pending_review");
  assert.equal(context.after.fileStatus, "approved");
  assert.equal(context.reason, "Listo");
  assert.equal(approves[0].demo_owned, 1);
});

test("mocked upload emits a demo-owned baseline indexed event", () => {
  const db = fixtureDb();
  seedFixtures(db);
  const project = getProject("costa-norte", db)!;
  const upload = addMockedUpload(project.id, "acta-simulada.pdf", db);
  const events = db
    .prepare(
      "SELECT * FROM decision_events WHERE file_id=? AND event_type='indexed'",
    )
    .all(upload.id) as any[];
  assert.equal(events.length, 1);
  assert.equal(events[0].demo_owned, 1);
  assert.equal(events[0].occurred_at, upload.modifiedAt);
  assert.equal(
    (JSON.parse(events[0].context_json) as any).after.fileStatus,
    "pending_ingestion",
  );
});

test("indexer intake emits a single baseline indexed event", () => {
  const db = fixtureDb();
  seedFixtures(db);
  const project = getProject("costa-norte", db)!;
  const input = {
    projectId: project.id,
    sourcePath: "C:/source/plano.pdf",
    filename: "plano.pdf",
    extension: ".pdf",
    sizeBytes: 1,
    modifiedAt: "2026-10-08T00:00:00.000Z",
    documentType: "other",
  };
  upsertIndexedFile(input, db);
  upsertIndexedFile(input, db);
  const row = db
    .prepare("SELECT id FROM files WHERE stable_identity=?")
    .get("C:/source/plano.pdf") as { id: string };
  const events = db
    .prepare(
      "SELECT * FROM decision_events WHERE file_id=? AND event_type='indexed'",
    )
    .all(row.id) as any[];
  assert.equal(events.length, 1);
  assert.equal(events[0].demo_owned, 0);
  assert.equal(events[0].occurred_at, "2026-10-08T00:00:00.000Z");
});

test("reset seeds baseline and coherent approve/superseded history and preserves non-demo records", () => {
  const db = fixtureDb();
  seedFixtures(db);
  db.prepare(
    "INSERT INTO projects (id,slug,name,source_root,created_at,updated_at,demo_owned) VALUES ('project-real','real-obra','Obra Real','C:/real','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',0)",
  ).run();
  db.prepare(
    "INSERT INTO files (id,project_id,stable_identity,filename,source_path,extension,size_bytes,modified_at,document_type,status,index_state,metadata_text,created_at,updated_at,demo_owned) VALUES ('real-file','project-real','real:1','real.pdf','C:/real/real.pdf','.pdf',1,'2026-01-01T00:00:00.000Z','other','pending_review','indexed','','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',0)",
  ).run();
  db.prepare(
    "INSERT INTO decision_events (id,review_item_id,file_id,entity_type,entity_id,event_type,actor_id,actor_name,actor_role,occurred_at,context_json,demo_owned) VALUES ('event-real-indexed',NULL,'real-file','file_classification','real-file','indexed','system','System',NULL,'2026-01-01T00:00:00.000Z','{}',0)",
  ).run();

  resetDemoFixtures(db);

  assert.ok(db.prepare("SELECT id FROM projects WHERE id='project-real'").get());
  assert.ok(db.prepare("SELECT id FROM files WHERE id='real-file'").get());
  assert.ok(
    db
      .prepare("SELECT id FROM decision_events WHERE id='event-real-indexed'")
      .get(),
  );

  const revB = fileEvents(db, "costa-plan-old");
  assert.deepEqual(
    revB.map((event) => event.event_type),
    ["indexed", "approve", "superseded"],
  );
  const revC = fileEvents(db, "costa-plan-current");
  assert.deepEqual(
    revC.map((event) => event.event_type),
    ["indexed", "approve"],
  );
});

test("reconstruction reports approved before a superseded event and superseded after", () => {
  const db = fixtureDb();
  seedFixtures(db);
  const before = reconstructAsOf(
    "project-costa-norte",
    "2026-09-01T12:00:00.000Z",
    db,
  ).snapshot!;
  const after = reconstructAsOf(
    "project-costa-norte",
    "2026-10-06T12:00:00.000Z",
    db,
  ).snapshot!;
  const revBBefore = before.documents.find(
    (document) => document.id === "costa-plan-old",
  )!;
  const revBAfter = after.documents.find(
    (document) => document.id === "costa-plan-old",
  )!;
  assert.equal(revBBefore.status, "approved");
  assert.equal(revBAfter.status, "superseded");
});

test("timestamp before the earliest event reports ingestion state with priorToFirstDecision", () => {
  const db = fixtureDb();
  seedFixtures(db);
  const snapshot = reconstructAsOf(
    "project-costa-norte",
    "2026-08-01T00:00:00.000Z",
    db,
  ).snapshot!;
  for (const document of snapshot.documents) {
    assert.equal(document.priorToFirstDecision, true);
    assert.equal(document.decision, null);
  }
  const revC = snapshot.documents.find(
    (document) => document.id === "costa-plan-current",
  )!;
  assert.equal(revC.status, "pending_review");
});

test("current document flips from Rev B to Rev C across the 2026-10-05 boundary", () => {
  const db = fixtureDb();
  seedFixtures(db);
  const before = reconstructAsOf(
    "project-costa-norte",
    "2026-09-01T12:00:00.000Z",
    db,
  ).snapshot!;
  const after = reconstructAsOf(
    "project-costa-norte",
    "2026-10-06T12:00:00.000Z",
    db,
  ).snapshot!;
  assert.ok(before.currentDocumentIds.includes("costa-plan-old"));
  assert.ok(!before.currentDocumentIds.includes("costa-plan-current"));
  assert.ok(after.currentDocumentIds.includes("costa-plan-current"));
  assert.ok(!after.currentDocumentIds.includes("costa-plan-old"));
});

test("reconstruction validates unknown project, malformed, and future timestamps", () => {
  const db = fixtureDb();
  seedFixtures(db);
  assert.equal(
    reconstructAsOf("project-no-existe", "2026-09-01T12:00:00.000Z", db).error
      ?.code,
    "project_not_found",
  );
  assert.equal(
    reconstructAsOf("project-costa-norte", "not-a-date", db).error?.code,
    "invalid_timestamp",
  );
  assert.equal(
    reconstructAsOf("project-costa-norte", "2999-01-01T00:00:00.000Z", db)
      .error?.code,
    "future_timestamp",
  );
});

test("historical decision evidence remains stable after a later live status change", () => {
  const db = fixtureDb();
  seedFixtures(db);
  const snapshot = reconstructAsOf(
    "project-costa-norte",
    "2026-09-01T12:00:00.000Z",
    db,
  ).snapshot!;
  const before = snapshot.documents.find(
    (document) => document.id === "costa-plan-old",
  )!;
  assert.ok(before.decision);
  db.prepare(
    "UPDATE files SET status='pending_review' WHERE id='costa-plan-old'",
  ).run();
  const after = reconstructAsOf(
    "project-costa-norte",
    "2026-09-01T12:00:00.000Z",
    db,
  ).snapshot!;
  const stable = after.documents.find(
    (document) => document.id === "costa-plan-old",
  )!;
  assert.deepEqual(stable.decision, before.decision);
});
