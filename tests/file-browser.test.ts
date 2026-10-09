import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { browserModel } from "../app/.server/file-browser.server";
import {
  openDatabase,
  seedFixtures,
  upsertIndexedFile,
} from "../app/.server/db.server";
import { createFolder } from "../app/.server/library-management.server";
import { saveManagedUpload } from "../app/.server/managed-upload.server";

test("shared browser preserves cross-view identities, selection, folder search and permission boundaries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "browser-model-"));
  process.env.MANAGED_STORAGE_ROOT = path.join(root, "managed");
  process.env.SOURCE_ROOT = path.join(root, "source");
  await fs.mkdir(path.join(root, "source", "Planos", "Norte"), {
    recursive: true,
  });
  const sourcePath = path.join(
    root,
    "source",
    "Planos",
    "Norte",
    "archivo.txt",
  );
  await fs.writeFile(sourcePath, "ubicación real");
  const db = openDatabase(path.join(root, "test.sqlite"));
  seedFixtures(db);
  upsertIndexedFile(
    {
      projectId: "project-costa-norte",
      sourcePath,
      filename: "archivo.txt",
      extension: ".txt",
      sizeBytes: 14,
      modifiedAt: new Date().toISOString(),
      documentType: "technical",
    },
    db,
  );
  const collection = "collection-project-project-costa-norte";
  const parent = createFolder("manager", collection, null, "Planos", db);
  const child = createFolder("manager", collection, parent.id, "Anexos", db);
  const upload = await saveManagedUpload(
    "employee",
    {
      collectionId: collection,
      folderId: child.id,
      file: new File(["aguja"], "aguja.txt"),
    },
    db,
  );
  let ids: string[] | undefined;
  for (const view of ["list", "grid", "folders"]) {
    const model = await browserModel(
      "employee",
      new URL(
        `http://test/file?view=${view}&q=aguja&folder=managed:${parent.id}&selected=${upload.id}&sort=name`,
      ),
      undefined,
      db,
    );
    assert.equal(model.count, 1);
    assert.deepEqual(
      model.graph.nodes.map((node) => node.id),
      model.files.map((file) => file.id),
    );
    assert.equal(model.graph.edges.length, 0);
    assert.equal(model.selected?.id, upload.id);
    assert.ok(
      model.folders.some(
        (f) => f.id === "managed:" + child.id && f.count === 1,
      ),
    );
    if (ids)
      assert.deepEqual(
        model.files.map((f) => f.id),
        ids,
      );
    else ids = model.files.map((f) => f.id);
  }
  const all = await browserModel(
    "employee",
    new URL(
      `http://test/file?searchScope=all&folder=managed:${parent.id}&collection=${collection}`,
    ),
    undefined,
    db,
  );
  assert.equal(all.folderId, "");
  assert.equal(all.collectionId, "");
  assert.ok(
    all.files.some((f) => f.collectionId === "collection-shared-resources"),
  );
  assert.ok(
    all.files.every((f) => f.collectionId !== "collection-administration"),
  );
  const sourceFolder = all.folders.find(
    (f) => f.kind === "source" && f.name === "Planos",
  )!;
  const sourceSearch = await browserModel(
    "employee",
    new URL(`http://test/file?folder=${sourceFolder.id}&q=archivo`),
    undefined,
    db,
  );
  assert.equal(sourceSearch.count, 1);
  assert.ok(sourceSearch.files[0].location.endsWith("Planos/Norte"));
  await assert.rejects(
    browserModel(
      "employee",
      new URL("http://test/file?folder=../../secret"),
      undefined,
      db,
    ),
  );
  const admin = await browserModel(
    "administration-staff",
    new URL("http://test/file"),
    undefined,
    db,
  );
  assert.ok(
    admin.files.some((f) => f.collectionId === "collection-administration"),
  );
  assert.ok(!JSON.stringify(admin).includes("costa-plan-current"));
  db.prepare(
    "INSERT INTO file_relations (from_file_id,to_file_id,relation) VALUES ('costa-plan-current','parque-memoria','supersedes')",
  ).run();
  const selected = await browserModel(
    "employee",
    new URL("http://test/file?evidence=costa-plan-current"),
    undefined,
    db,
  );
  assert.equal(selected.latestId, null);
  assert.ok(!JSON.stringify(selected).includes("parque-memoria"));
  const graphIds = new Set(selected.graph.nodes.map((node) => node.id));
  assert.ok(
    selected.graph.edges.every(
      (edge) => graphIds.has(edge.from) && graphIds.has(edge.to),
    ),
  );
  for (const key of [
    "reviewer",
    "reviewedAt",
    "reviewReason",
    "pending_review",
    "approved",
    "preview_content",
    "content_key",
  ])
    assert.ok(!JSON.stringify(selected).includes('"' + key + '"'), key);
  db.close();
});
