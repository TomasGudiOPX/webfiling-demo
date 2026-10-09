import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openDatabase, seedFixtures } from "../app/.server/db.server";
import { saveManagedUpload } from "../app/.server/managed-upload.server";
import {
  boundedFormData,
  validateUpload,
  MAX_REQUEST_BYTES,
} from "../app/.server/upload-validation.server";
import {
  contentResponse,
  fixtureDocx,
} from "../app/.server/file-content.server";
import {
  createFolder,
  editLibraryFile,
  setTrashed,
  resetSamples,
} from "../app/.server/library-management.server";
import { cleanupManagedStorage } from "../app/.server/managed-storage.server";
import { browserModel } from "../app/.server/file-browser.server";

const collection = "collection-project-project-costa-norte";
async function setup(upgrade = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "library-lifecycle-"));
  process.env.MANAGED_STORAGE_ROOT = path.join(root, "managed");
  process.env.SOURCE_ROOT = path.join(root, "source");
  await fs.mkdir(process.env.SOURCE_ROOT);
  const databasePath = path.join(root, "test.sqlite");
  let db = openDatabase(databasePath);
  seedFixtures(db);
  if (upgrade) {
    const schema = (
      db.prepare("SELECT sql FROM sqlite_master WHERE name='files'").get() as {
        sql: string;
      }
    ).sql;
    const legacy = schema
      .replace(/CREATE TABLE files/i, "CREATE TABLE files_legacy")
      .replace(
        "project_id TEXT REFERENCES",
        "project_id TEXT NOT NULL REFERENCES",
      );
    assert.notEqual(legacy, schema);
    db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
    db.exec(legacy);
    db.exec(
      "INSERT INTO files_legacy SELECT * FROM files; DROP TABLE files; ALTER TABLE files_legacy RENAME TO files; COMMIT; PRAGMA foreign_keys=ON",
    );
    db.close();
    db = openDatabase(databasePath);
    seedFixtures(db);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(
      db
        .prepare("PRAGMA table_info(files)")
        .all()
        .find((c) => c.name === "project_id")?.notnull,
      0,
    );
  }
  return { root, databasePath, db };
}
const file = (text = "contenido", name = "nota.txt") =>
  new File([text], name, { type: "text/plain" });

for (const upgrade of [false, true])
  test(`agent schema is additive and repeatable (${upgrade ? "upgraded" : "fresh"} database)`, async () => {
    const { db, databasePath } = await setup(upgrade);
    const before = Object.fromEntries(
      ["files", "collection_grants", "file_events"].map((table) => [
        table,
        (db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count,
      ]),
    );
    const expectedTables = [
      "agent_runs", "agent_steps", "agent_summaries", "collection_rules",
      "collection_rule_versions", "collection_periods", "collection_evidence",
      "collection_rule_events", "collection_events", "agent_schedules", "scheduled_runs", "agent_notices",
      "worker_heartbeats",
    ];
    for (const table of expectedTables)
      assert.ok(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),
        `missing ${table}`,
      );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.close();
    const reopened = openDatabase(databasePath);
    seedFixtures(reopened);
    for (const [table, count] of Object.entries(before))
      assert.equal(
        (reopened.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count,
        count,
        `${table} changed during repeated initialization`,
      );
    assert.deepEqual(reopened.prepare("PRAGMA foreign_key_check").all(), []);
    reopened.close();
  });

test("upload validation accepts supported signatures and rejects unsafe, empty, oversize, malformed content", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1EAAAAASUVORK5CYII=",
    "base64",
  );
  const webp = Buffer.from(
    "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
    "base64",
  );
  const docx = await fixtureDocx("Texto seguro");
  const oversizedArchive = Buffer.from(docx);
  const central = oversizedArchive.indexOf(
    Buffer.from([0x50, 0x4b, 0x01, 0x02]),
  );
  oversizedArchive.writeUInt32LE(21 * 1024 * 1024, central + 24);
  await assert.rejects(
    validateUpload(new File([new Uint8Array(oversizedArchive)], "bomb.docx")),
  );
  const pdf = await fs.readFile("private-fixtures/costa-norte/plano-rev-c.pdf");
  for (const [name, bytes] of [
    ["x.txt", Buffer.from("texto")],
    ["x.md", Buffer.from("# título")],
    ["x.pdf", pdf],
    ["x.png", png],
    ["x.jpg", Buffer.from([255, 216, 255, 224, 0, 2, 255, 217])],
    ["x.webp", webp],
    ["x.docx", docx],
  ] as const)
    assert.equal(
      (await validateUpload(new File([new Uint8Array(bytes)], name))).filename,
      name,
    );
  for (const invalid of [
    file("x", "../escape.txt"),
    file("x", "C:\\escape.txt"),
    file("x", "x\n.txt"),
    file("", "empty.txt"),
    file("not PDF", "bad.pdf"),
    file("PKbroken", "bad.docx"),
    file("<html>", "x.html"),
    file("x".repeat(20 * 1024 * 1024 + 1)),
    new File([new Uint8Array([0xff, 0])], "bad.txt"),
  ])
    await assert.rejects(validateUpload(invalid));
});

test("multipart limits count streamed bytes even with absent or false content length", async () => {
  for (const header of [undefined, "1"]) {
    let reads = 0;
    const request = new Request("http://example.test/upload", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=x",
        ...(header ? { "Content-Length": header } : {}),
      },
      body: new ReadableStream({
        pull(controller) {
          if (++reads <= 22) controller.enqueue(new Uint8Array(1024 * 1024));
          else controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    await assert.rejects(boundedFormData(request), /21 MiB/);
  }
  await assert.rejects(
    boundedFormData(
      new Request("http://example.test", {
        method: "POST",
        headers: { "Content-Length": String(MAX_REQUEST_BYTES + 1) },
        body: "x",
      }),
    ),
    /21 MiB/,
  );
  await assert.rejects(
    boundedFormData(
      new Request("http://example.test", {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data; boundary=x" },
        body: "bad multipart",
      }),
    ),
    /multipart/,
  );
  const form = new FormData();
  form.set("file", file());
  assert.ok(
    (
      await boundedFormData(
        new Request("http://example.test", { method: "POST", body: form }),
      )
    ).get("file") instanceof File,
  );
});

test("sample reset preserves user-created collection rules, evidence, history, and uploads", async () => {
  const { db, databasePath } = await setup();
  const upload = await saveManagedUpload(
    "employee",
    { collectionId: collection, file: file("informe real"), projectIds: ["project-costa-norte"] },
    db,
  );
  const timestamp = new Date().toISOString();
  db.prepare(
    "INSERT INTO collection_rules (id,creator_profile_id,recipient_profile_id,collection_id,current_version,created_at,updated_at) VALUES ('user-rule','employee','employee',?,1,?,?)",
  ).run(collection, timestamp, timestamp);
  db.prepare(
    "INSERT INTO collection_rule_versions (rule_id,version,definition_json,timezone,created_by,created_at) VALUES ('user-rule',1,'{}','America/Argentina/Buenos_Aires','employee',?)",
  ).run(timestamp);
  db.prepare(
    "INSERT INTO collection_periods (id,rule_id,rule_version,occurrence_key,recipient_profile_id,collection_id,opens_at,closes_at,timezone,status,created_at) VALUES ('user-period','user-rule',1,'occurrence-1','employee',?,?,?,?,'received',?)",
  ).run(collection, timestamp, "2026-10-09T00:00:00.000Z", "America/Argentina/Buenos_Aires", timestamp);
  db.prepare(
    "INSERT INTO collection_evidence (id,period_id,slot_key,file_id,contributor_profile_id,uploaded_at,linked_at,linked_by) VALUES ('user-evidence','user-period','report',?,'employee',?,?,'employee')",
  ).run(upload.id, timestamp, timestamp);
  db.prepare(
    "INSERT INTO collection_events (id,period_id,event_type,actor_profile_id,occurred_at,details_json) VALUES ('user-event','user-period','received','employee',?,'{}')",
  ).run(timestamp);
  db.prepare(
    "INSERT INTO agent_runs (id,profile_id,provider_version,intent,status,created_at) VALUES ('user-run','employee','demo-v1','upload','completed',?)",
  ).run(timestamp);
  resetSamples("system-administrator", db);
  assert.ok(db.prepare("SELECT 1 FROM files WHERE id=?").get(upload.id));
  assert.ok(db.prepare("SELECT 1 FROM collection_rules WHERE id='user-rule'").get());
  assert.ok(db.prepare("SELECT 1 FROM collection_periods WHERE id='user-period'").get());
  assert.ok(db.prepare("SELECT 1 FROM collection_evidence WHERE id='user-evidence'").get());
  assert.ok(db.prepare("SELECT 1 FROM collection_events WHERE id='user-event'").get());
  assert.ok(db.prepare("SELECT 1 FROM agent_runs WHERE id='user-run'").get());
  const restarted = openDatabase(databasePath);
  assert.deepEqual(restarted.prepare("PRAGMA foreign_key_check").all(), []);
  assert.ok(restarted.prepare("SELECT 1 FROM collection_evidence WHERE id='user-evidence'").get());
  const download = await contentResponse("employee", upload.id, true, restarted);
  assert.equal(await download.text(), "informe real");
  restarted.close();
});

for (const upgrade of [false, true])
  test(`upload transaction, duplicate names, actual events, restart, edits, trash and reset preserve bytes (${upgrade ? "upgraded" : "fresh"} database)`, async () => {
    const { db, databasePath } = await setup(upgrade);
    const folder = createFolder("manager", collection, null, "Planos", db);
    assert.throws(() =>
      createFolder("employee", collection, null, "Denegado", db),
    );
    const uploads = await Promise.all(
      [1, 2].map(() =>
        saveManagedUpload(
          "employee",
          {
            collectionId: collection,
            file: file(),
            folderId: folder.id,
            projectIds: ["project-costa-norte"],
          },
          db,
        ),
      ),
    );
    assert.notEqual(uploads[0].id, uploads[1].id);
    assert.ok(uploads.some((u) => u.duplicateName));
    const id = uploads[0].id;
    assert.equal(
      (
        db
          .prepare(
            "SELECT count(*) n FROM file_events WHERE file_id=? AND event_type='uploaded'",
          )
          .get(id) as { n: number }
      ).n,
      1,
    );
    const before = JSON.stringify(
      db.prepare("SELECT * FROM files WHERE id=?").get(id),
    );
    assert.throws(() =>
      editLibraryFile("employee", id, { categoryId: "nonsense" }, db),
    );
    assert.throws(() =>
      editLibraryFile(
        "employee",
        id,
        { projectIds: ["project-parque-industrial"] },
        db,
      ),
    );
    const otherFolder = createFolder(
      "manager",
      "collection-project-project-parque-industrial",
      null,
      "Ajena",
      db,
    );
    assert.throws(() =>
      editLibraryFile("employee", id, { folderId: otherFolder.id }, db),
    );
    assert.equal(
      JSON.stringify(db.prepare("SELECT * FROM files WHERE id=?").get(id)),
      before,
    );
    editLibraryFile(
      "manager",
      id,
      {
        displayName: "Nuevo.txt",
        folderId: null,
        categoryId: "technical",
        discipline: "structures",
        projectIds: ["project-costa-norte", "project-parque-industrial"],
      },
      db,
    );
    assert.equal(
      (
        db
          .prepare("SELECT count(*) n FROM file_projects WHERE file_id=?")
          .get(id) as { n: number }
      ).n,
      2,
    );
    const events = (
      db
        .prepare("SELECT event_type FROM file_events WHERE file_id=?")
        .all(id) as Array<{ event_type: string }>
    ).map((e) => e.event_type);
    for (const event of [
      "uploaded",
      "metadata_changed",
      "projects_changed",
      "moved",
      "renamed",
    ])
      assert.ok(events.includes(event));
    assert.throws(() =>
      editLibraryFile(
        "manager",
        "costa-plan-current",
        { displayName: "changed.pdf" },
        db,
      ),
    );
    const managerUpload = await saveManagedUpload(
      "manager",
      { collectionId: collection, file: file("otro") },
      db,
    );
    assert.throws(() => setTrashed("employee", managerUpload.id, true, db));
    setTrashed("employee", id, true, db);
    assert.equal((await contentResponse("employee", id, true, db)).status, 404);
    const ownTrash = await browserModel(
      "employee",
      new URL("http://test/file?trash=1"),
      undefined,
      db,
    );
    assert.ok(ownTrash.files.some((f) => f.id === id));
    setTrashed("manager", managerUpload.id, true, db);
    const scopedTrash = await browserModel(
      "employee",
      new URL("http://test/file?trash=1"),
      undefined,
      db,
    );
    assert.ok(!scopedTrash.files.some((f) => f.id === managerUpload.id));
    assert.throws(() => setTrashed("administration-staff", id, false, db));
    assert.throws(() => resetSamples("employee", db));
    resetSamples("system-administrator", db);
    assert.ok(
      db.prepare("SELECT * FROM managed_folders WHERE id=?").get(folder.id),
    );
    assert.equal(
      (
        db
          .prepare("SELECT count(*) n FROM file_events WHERE file_id=?")
          .get(id) as { n: number }
      ).n,
      6,
    );
    setTrashed("employee", id, false, db);
    db.close();
    const reopened = openDatabase(databasePath);
    assert.equal(
      await (await contentResponse("employee", id, true, reopened)).text(),
      "contenido",
    );
    assert.equal(
      (await contentResponse("administration-staff", id, true, reopened))
        .status,
      404,
    );
    reopened.close();
  });

test("DB failure cleans new bytes and bounded cleanup preserves referenced files including trash", async () => {
  const { db, root } = await setup();
  await saveManagedUpload(
    "employee",
    { collectionId: collection, file: file() },
    db,
  );
  const objects = path.join(root, "managed", "objects");
  const before = await fs.readdir(objects);
  const copyFile = fs.copyFile;
  fs.copyFile = async () => {
    throw new Error("injected filesystem failure");
  };
  try {
    await assert.rejects(
      saveManagedUpload(
        "employee",
        { collectionId: collection, file: file() },
        db,
      ),
      /filesystem failure/,
    );
  } finally {
    fs.copyFile = copyFile;
  }
  assert.deepEqual(await fs.readdir(objects), before);
  assert.deepEqual(await fs.readdir(path.join(root, "managed", "staging")), []);
  db.exec(
    "CREATE TRIGGER fail_upload BEFORE INSERT ON file_events BEGIN SELECT RAISE(ABORT,'injected DB failure'); END",
  );
  await assert.rejects(
    saveManagedUpload(
      "employee",
      { collectionId: collection, file: file() },
      db,
    ),
    /injected/,
  );
  assert.deepEqual(await fs.readdir(objects), before);
  assert.deepEqual(await fs.readdir(path.join(root, "managed", "staging")), []);
  db.exec("DROP TRIGGER fail_upload");
  const upload = await saveManagedUpload(
    "employee",
    { collectionId: collection, file: file() },
    db,
  );
  setTrashed("employee", upload.id, true, db);
  const orphan = randomUUID();
  await fs.writeFile(path.join(objects, orphan), "orphan");
  const recent = randomUUID();
  await fs.writeFile(path.join(objects, recent), "recent");
  for (const name of [...before, orphan])
    await fs.utimes(path.join(objects, name), new Date(0), new Date(0));
  const key = (
    db
      .prepare("SELECT content_key FROM library_file_metadata WHERE file_id=?")
      .get(upload.id) as { content_key: string }
  ).content_key;
  await fs.utimes(path.join(objects, key), new Date(0), new Date(0));
  assert.equal((await cleanupManagedStorage(db)).removed, 1);
  for (const name of [...before, key, recent])
    await fs.access(path.join(objects, name));
  db.close();
});

test("source content stays unchanged and unsupported previews download safely", async () => {
  const { db, root } = await setup();
  const source = path.join(root, "source", "original.bin");
  await fs.writeFile(source, "source original");
  db.prepare(
    "UPDATE files SET source_path=?,extension='.bin' WHERE id='costa-photo'",
  ).run(source);
  db.prepare(
    "UPDATE library_file_metadata SET origin='source' WHERE file_id='costa-photo'",
  ).run();
  const response = await contentResponse("employee", "costa-photo", false, db);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Disposition")!, /^attachment/);
  assert.equal(await response.text(), "source original");
  assert.throws(() => setTrashed("manager", "costa-photo", true, db));
  assert.equal(await fs.readFile(source, "utf8"), "source original");
  await fs.unlink(source);
  assert.equal(
    (await contentResponse("employee", "costa-photo", true, db)).status,
    404,
  );
  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "secret.txt"), "secret");
  await fs.symlink(outside, path.join(root, "source", "escape"), "junction");
  db.prepare(
    "UPDATE files SET source_path=?,extension='.txt' WHERE id='costa-photo'",
  ).run(path.join(root, "source", "escape", "secret.txt"));
  assert.equal(
    (await contentResponse("employee", "costa-photo", true, db)).status,
    404,
  );
  db.close();
});
