import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import mammoth from "mammoth";
import { openDatabase, seedFixtures } from "../app/.server/db.server";
import {
  contentResponse,
  readFileContent,
  containedPath,
} from "../app/.server/file-content.server";

test("private fixtures provide authorized PDF, image, Markdown and real DOCX bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "file-content-"));
  const db = openDatabase(path.join(root, "test.sqlite"));
  seedFixtures(db);
  for (const [id, mime] of [
    ["costa-plan-current", "application/pdf"],
    ["costa-photo", "image/svg+xml"],
    ["parque-memoria", "text/markdown; charset=utf-8"],
    [
      "costa-notice",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  ]) {
    const content = await readFileContent("manager", id, db);
    assert.ok(content, id);
    assert.equal(content.mime, mime);
    assert.ok(content.bytes.length);
    const response = await contentResponse("manager", id, false, db);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  const docx = await readFileContent("employee", "costa-notice", db);
  assert.match(
    (await mammoth.extractRawText({ buffer: docx!.bytes })).value,
    /canaleta técnica/,
  );
  const denied = await contentResponse("employee", "parque-memoria", true, db);
  const missing = await contentResponse("employee", "missing", true, db);
  assert.equal(denied.status, 404);
  assert.deepEqual(await denied.json(), await missing.json());
  await assert.rejects(fs.access(path.resolve("public/fixtures")));
  await assert.rejects(
    containedPath(path.resolve("fixtures"), path.resolve("package.json")),
    /outside/,
  );
  const download = await contentResponse(
    "employee",
    "costa-plan-current",
    true,
    db,
  );
  assert.match(download.headers.get("Content-Disposition")!, /^attachment;/);
  db.close();
});
