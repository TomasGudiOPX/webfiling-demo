import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addMockedUpload,
  getProject,
  listFindings,
  listProjectFiles,
  openDatabase,
  resetDemoFixtures,
  reviewFile,
  seedFixtures,
  upsertIndexedFile,
} from "../app/.server/db.server";
import { assertAllowedSourceRoot } from "../app/.server/config";
import { scenarioRegistry } from "../app/scenarios";

test("source allowlist rejects paths outside configured root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-root-"));
  assert.equal(assertAllowedSourceRoot(root, root), root);
  assert.throws(
    () => assertAllowedSourceRoot(path.dirname(root), root),
    /outside/,
  );
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
    listFindings(parque.id, db).filter((finding) => finding.state !== "open")
      .length,
    0,
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
