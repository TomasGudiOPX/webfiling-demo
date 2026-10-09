import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase, seedFixtures } from "../app/.server/db.server";
import { saveManagedUpload } from "../app/.server/managed-upload.server";

test("managed uploads use an opaque exclusive object and preserve uploaded bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "webfiling-managed-"));
  process.env.MANAGED_STORAGE_ROOT = path.join(root, "objects");
  const db = openDatabase(path.join(root, "demo.sqlite"));
  seedFixtures(db);
  const upload = await saveManagedUpload(
    "employee",
    {
      collectionId: "collection-project-project-costa-norte",
      file: new File(["private content"], "nota.md", { type: "text/markdown" }),
    },
    db,
  );
  const row = db.prepare("SELECT content_key FROM library_file_metadata WHERE file_id=?").get(upload.id) as { content_key: string };
  assert.equal(
    await fs.readFile(path.join(process.env.MANAGED_STORAGE_ROOT!, "objects", row.content_key), "utf8"),
    "private content",
  );
  await assert.rejects(
    () => saveManagedUpload(
      "employee",
      {
        collectionId: "collection-administration",
        file: new File(["x"], "blocked.txt", { type: "text/plain" }),
      },
      db,
    ),
    /not permitted/,
  );
});
