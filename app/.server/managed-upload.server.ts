import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { collectionCapabilities } from "./file-access.server";
import { openDatabase, rebuildSearchIndex } from "./db.server";
import type { DemoProfileId } from "../types";
import { validateUpload, FileInputError } from "./upload-validation.server";
import { managedDirectories } from "./managed-storage.server";
import {
  transaction,
  fileEvent,
  validateFolder,
  validateProjectLinks,
} from "./library-management.server";

export async function saveManagedUpload(
  profileId: DemoProfileId,
  input: {
    collectionId: string;
    file: File;
    folderId?: string | null;
    projectIds?: string[];
  },
  db: DatabaseSync = openDatabase(),
) {
  if (!collectionCapabilities(profileId, input.collectionId, db).canContribute)
    throw new FileInputError("Upload destination is not permitted.", 403);
  validateFolder(input.collectionId, input.folderId ?? null, db);
  const projectIds = validateProjectLinks(
    profileId,
    input.projectIds ?? [],
    db,
  );
  const { filename, extension, bytes, text } = await validateUpload(input.file);
  const dirs = await managedDirectories();
  const key = randomUUID();
  const staged = path.join(dirs.staging, key);
  const object = path.join(dirs.objects, key);
  let stagedOwned = false;
  let objectOwned = false;
  try {
    const handle = await fs.open(staged, "wx");
    stagedOwned = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // COPYFILE_EXCL preserves exclusive creation across concurrent requests.
    await fs.copyFile(staged, object, fs.constants.COPYFILE_EXCL);
    objectOwned = true;
    await fs.unlink(staged);
    stagedOwned = false;
    return transaction(db, () => {
      if (
        !collectionCapabilities(profileId, input.collectionId, db).canContribute
      )
        throw new FileInputError("Upload destination is not permitted.", 403);
      validateFolder(input.collectionId, input.folderId ?? null, db);
      validateProjectLinks(profileId, projectIds, db);
      const duplicateName = Boolean(
        db
          .prepare(
            "SELECT 1 FROM library_file_metadata WHERE collection_id=? AND display_name=? AND trashed_at IS NULL",
          )
          .get(input.collectionId, filename),
      );
      const timestamp = new Date().toISOString();
      const fileId = randomUUID();
      db.prepare(
        "INSERT INTO files (id,project_id,stable_identity,filename,source_path,extension,size_bytes,modified_at,document_type,status,index_state,metadata_text,created_at,updated_at,demo_owned) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)",
      ).run(
        fileId,
        projectIds[0] ?? null,
        "managed:" + key,
        filename,
        "",
        extension,
        bytes.length,
        timestamp,
        "other",
        "pending_review",
        "indexed",
        filename + " " + text,
        timestamp,
        timestamp,
      );
      db.prepare(
        "INSERT INTO library_file_metadata (file_id,collection_id,origin,content_key,managed_folder_id,display_name,contributor_id,availability,sample_owned,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        fileId,
        input.collectionId,
        "managed_upload",
        key,
        input.folderId ?? null,
        filename,
        profileId,
        "available",
        0,
        timestamp,
        timestamp,
      );
      for (const id of projectIds)
        db.prepare(
          "INSERT INTO file_projects (file_id,project_id,created_at) VALUES (?,?,?)",
        ).run(fileId, id, timestamp);
      fileEvent(db, fileId, profileId, "uploaded", null, {
        filename,
        sizeBytes: bytes.length,
        collectionId: input.collectionId,
        folderId: input.folderId ?? null,
        projectIds,
      });
      rebuildSearchIndex(db);
      return { id: fileId, filename, sizeBytes: bytes.length, duplicateName };
    });
  } catch (error) {
    if (stagedOwned) await fs.rm(staged, { force: true });
    if (objectOwned) await fs.rm(object, { force: true });
    throw error;
  }
}
