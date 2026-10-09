import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase, seedFixtures } from "../app/.server/db.server";
import { fixtureDocx } from "../app/.server/file-content.server";
import { saveManagedUpload } from "../app/.server/managed-upload.server";
import { extractGroundedSummarySource } from "../app/.server/summary-extraction.server";

const collectionId = "collection-project-project-costa-norte";
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "webfiling-summary-"));
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

test("summary excerpts are grounded in authorized real TXT/DOCX bytes with bounded truncation", async () => {
  const { root, db } = await setup();
  const txt = await saveManagedUpload("employee", {
    collectionId, file: new File(["Primera conclusión verificable. Segunda conclusión del archivo."], "informe.txt", { type: "text/plain" }),
  }, db);
  const textResult = await extractGroundedSummarySource("employee", txt.id, db);
  assert.equal(textResult?.extractionMethod, "text");
  assert.match(textResult?.excerptText ?? "", /Primera conclusión verificable/);
  assert.equal(await extractGroundedSummarySource("administration-staff", txt.id, db), null);

  const docxBytes = await fixtureDocx("Contenido DOCX comprobable.");
  const docx = await saveManagedUpload("employee", {
    collectionId, file: new File([new Uint8Array(docxBytes)], "informe.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
  }, db);
  const docxResult = await extractGroundedSummarySource("employee", docx.id, db);
  assert.equal(docxResult?.extractionMethod, "docx");
  assert.match(docxResult?.excerptText ?? "", /Contenido DOCX comprobable/);
  const objectKey = (db.prepare("SELECT content_key FROM library_file_metadata WHERE file_id=?").get(docx.id) as { content_key: string }).content_key;
  await fs.writeFile(path.join(root, "managed", "objects", objectKey), "malformed archive");
  assert.equal(await extractGroundedSummarySource("employee", docx.id, db), null);

  const long = await saveManagedUpload("employee", {
    collectionId, file: new File(["Párrafo extenso con evidencia. ".repeat(700)], "largo.txt", { type: "text/plain" }),
  }, db);
  const bounded = await extractGroundedSummarySource("employee", long.id, db);
  assert.equal(bounded?.truncated, true);
  assert.ok((bounded?.excerptText.length ?? 0) <= 12_000);
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});

test("PDF extraction uses metadata only and unavailable/oversized sources fail safely", async () => {
  const { root, db } = await setup();
  const pdf = await saveManagedUpload("employee", {
    collectionId, file: new File([Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9])], "plan.jpg", { type: "image/jpeg" }),
  }, db);
  const fallback = await extractGroundedSummarySource("employee", pdf.id, db);
  assert.equal(fallback?.extractionMethod, "metadata_only");
  assert.doesNotMatch(fallback?.excerptText ?? "", /intentionally not extracted/);
  const oversized = await saveManagedUpload("employee", {
    collectionId, file: new File(["x".repeat(5 * 1024 * 1024 + 1)], "oversized.txt", { type: "text/plain" }),
  }, db);
  assert.equal(await extractGroundedSummarySource("employee", oversized.id, db), null);
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});
