import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loader as fileLoader } from "../app/routes/api.files.$fileId";
import { loader as searchLoader } from "../app/routes/api.search";
import { openDatabase, seedFixtures } from "../app/.server/db.server";

function temporaryDatabase() {
  const databasePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-route-access-")),
    "demo.sqlite",
  );
  process.env.DATABASE_PATH = databasePath;
  process.env.DEMO_MODE = "true";
  const db = openDatabase(databasePath);
  seedFixtures(db);
  const timestamp = "2026-10-08T00:00:00.000Z";
  db.prepare(
    "INSERT OR IGNORE INTO files (id,project_id,stable_identity,filename,source_path,modified_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    "restricted-file",
    "project-torre-horizonte",
    "source:restricted-file",
    "administracion-secreta.pdf",
    "",
    timestamp,
    "pending_review",
    timestamp,
    timestamp,
  );
  db.prepare(
    "INSERT OR IGNORE INTO library_file_metadata (file_id,collection_id,origin,display_name,availability,sample_owned,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    "restricted-file",
    "collection-administration",
    "source",
    "administracion-secreta.pdf",
    "available",
    0,
    timestamp,
    timestamp,
  );
}

test("restricted and missing files both return not found", async () => {
  temporaryDatabase();
  const restricted = await fileLoader({
    request: new Request("http://example.test/api/files/restricted-file"),
    params: { fileId: "restricted-file" },
    context: {},
  } as any);
  const unknown = await fileLoader({
    request: new Request("http://example.test/api/files/also-missing"),
    params: { fileId: "also-missing" },
    context: {},
  } as any);
  assert.equal(restricted.status, 404);
  assert.deepEqual(await restricted.json(), await unknown.json());
});

test("search applies employee grants before counts and results", async () => {
  temporaryDatabase();
  const response = await searchLoader({
    request: new Request("http://example.test/api/search?q=administracion-secreta"),
    params: {},
    context: {},
  } as any);
  const body = await response.json() as {
    results: Array<{ id: string }>;
    counts: { matchingFiles: number };
  };
  assert.deepEqual(body.results, []);
  assert.equal(body.counts.matchingFiles, 0);
});
