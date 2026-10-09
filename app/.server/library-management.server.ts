import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  DOCUMENT_CATEGORIES,
  DISCIPLINE_TAGS,
  LOCATION_TAGS,
  type DemoProfileId,
} from "../types";
import {
  openDatabase,
  rebuildSearchIndex,
  resetDemoFixtures,
} from "./db.server";
import { collectionCapabilities, fileCapabilities } from "./file-access.server";
import { FileInputError, safeDisplayName } from "./upload-validation.server";

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function fileEvent(
  db: DatabaseSync,
  fileId: string,
  actor: DemoProfileId,
  type: string,
  before: unknown,
  after: unknown,
) {
  db.prepare(
    "INSERT INTO file_events (id,file_id,event_type,actor_id,occurred_at,before_json,after_json) VALUES (?,?,?,?,?,?,?)",
  ).run(
    randomUUID(),
    fileId,
    type,
    actor,
    new Date().toISOString(),
    JSON.stringify(before),
    JSON.stringify(after),
  );
}
export function allowedProjects(profile: DemoProfileId, db: DatabaseSync) {
  return db
    .prepare(
      `SELECT DISTINCT p.id,p.slug,p.name FROM projects p
    WHERE EXISTS (SELECT 1 FROM collections c JOIN collection_grants g ON g.collection_id=c.id WHERE c.project_id=p.id AND g.profile_id=? AND g.can_read=1)
    OR EXISTS (SELECT 1 FROM file_projects fp JOIN library_file_metadata m ON m.file_id=fp.file_id JOIN collection_grants g ON g.collection_id=m.collection_id WHERE fp.project_id=p.id AND g.profile_id=? AND g.can_read=1 AND m.trashed_at IS NULL)
    ORDER BY p.name`,
    )
    .all(profile, profile) as Array<{ id: string; slug: string; name: string }>;
}
export function validateProjectLinks(
  profile: DemoProfileId,
  projectIds: string[],
  db: DatabaseSync,
) {
  const allowed = new Set(allowedProjects(profile, db).map((p) => p.id));
  if (projectIds.length > 30 || projectIds.some((id) => !allowed.has(id)))
    throw new FileInputError("Proyecto no disponible.", 404);
  return [...new Set(projectIds)];
}
export function validateFolder(
  collectionId: string,
  folderId: string | null,
  db: DatabaseSync,
) {
  if (
    folderId &&
    !db
      .prepare("SELECT id FROM managed_folders WHERE id=? AND collection_id=?")
      .get(folderId, collectionId)
  )
    throw new FileInputError("Carpeta no disponible.", 404);
}
export function createFolder(
  profile: DemoProfileId,
  collectionId: string,
  parentId: string | null,
  name: string,
  db = openDatabase(),
) {
  const caps = collectionCapabilities(profile, collectionId, db);
  if (!caps.canRead) throw new FileInputError("Colección no disponible.", 404);
  if (!caps.canOrganize)
    throw new FileInputError("No puede crear carpetas en esta colección.", 403);
  const displayName = safeDisplayName(name);
  return transaction(db, () => {
    validateFolder(collectionId, parentId, db);
    if (
      db
        .prepare(
          "SELECT id FROM managed_folders WHERE collection_id=? AND parent_id IS ? AND display_name=?",
        )
        .get(collectionId, parentId, displayName)
    )
      throw new FileInputError("Ya existe una carpeta con ese nombre.", 409);
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO managed_folders (id,collection_id,parent_id,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    ).run(id, collectionId, parentId, displayName, now, now);
    return { id, displayName };
  });
}
export interface FileEdits {
  categoryId?: string | null;
  discipline?: string | null;
  location?: string | null;
  projectIds?: string[];
  displayName?: string;
  folderId?: string | null;
}
export function editLibraryFile(
  profile: DemoProfileId,
  fileId: string,
  edits: FileEdits,
  db = openDatabase(),
) {
  return transaction(db, () => {
    const caps = fileCapabilities(profile, fileId, db);
    const before = db
      .prepare(
        `SELECT f.category_id,f.discipline_tag,f.location_tag,m.* FROM library_file_metadata m JOIN files f ON f.id=m.file_id WHERE m.file_id=?`,
      )
      .get(fileId) as Record<string, string | null> | undefined;
    if (!before || !caps?.canRead || before.trashed_at)
      throw new FileInputError("Archivo no disponible.", 404);
    if (!caps.canEdit)
      throw new FileInputError("No puede organizar este archivo.", 403);
    for (const [key, values] of [
      ["categoryId", DOCUMENT_CATEGORIES.map((c) => c.id)],
      ["discipline", Object.keys(DISCIPLINE_TAGS)],
      ["location", Object.keys(LOCATION_TAGS)],
    ] as const)
      if (edits[key] && !(values as readonly string[]).includes(edits[key]!))
        throw new FileInputError("Categoría o etiqueta inválida.");
    if (
      (edits.displayName !== undefined || edits.folderId !== undefined) &&
      before.origin !== "managed_upload"
    )
      throw new FileInputError(
        "Los originales del servidor son de solo lectura.",
        403,
      );
    if (edits.folderId !== undefined)
      validateFolder(before.collection_id!, edits.folderId, db);
    const name =
      edits.displayName === undefined
        ? before.display_name!
        : safeDisplayName(edits.displayName);
    const now = new Date().toISOString();
    const after = {
      categoryId:
        edits.categoryId === undefined ? before.category_id : edits.categoryId,
      discipline:
        edits.discipline === undefined
          ? before.discipline_tag
          : edits.discipline,
      location:
        edits.location === undefined ? before.location_tag : edits.location,
    };
    const previous = {
      categoryId: before.category_id,
      discipline: before.discipline_tag,
      location: before.location_tag,
    };
    if (JSON.stringify(after) !== JSON.stringify(previous)) {
      db.prepare(
        "UPDATE files SET category_id=?,discipline_tag=?,location_tag=?,updated_at=? WHERE id=?",
      ).run(after.categoryId, after.discipline, after.location, now, fileId);
      fileEvent(db, fileId, profile, "metadata_changed", previous, after);
    }
    if (edits.projectIds !== undefined) {
      const requested = validateProjectLinks(profile, edits.projectIds, db);
      const oldIds = (
        db
          .prepare(
            "SELECT project_id FROM file_projects WHERE file_id=? ORDER BY project_id",
          )
          .all(fileId) as Array<{ project_id: string }>
      ).map((p) => p.project_id);
      const visibleProjects = new Set(
        allowedProjects(profile, db).map((p) => p.id),
      );
      const ids = [
        ...new Set([
          ...requested,
          ...oldIds.filter((id) => !visibleProjects.has(id)),
        ]),
      ].sort();
      if (JSON.stringify(ids) !== JSON.stringify(oldIds)) {
        db.prepare("DELETE FROM file_projects WHERE file_id=?").run(fileId);
        for (const id of ids)
          db.prepare(
            "INSERT INTO file_projects (file_id,project_id,created_at) VALUES (?,?,?)",
          ).run(fileId, id, now);
        db.prepare("UPDATE files SET project_id=?,updated_at=? WHERE id=?").run(
          ids[0] ?? null,
          now,
          fileId,
        );
        fileEvent(db, fileId, profile, "projects_changed", oldIds, ids);
      }
    }
    if (name !== before.display_name) {
      db.prepare(
        "UPDATE library_file_metadata SET display_name=?,updated_at=? WHERE file_id=?",
      ).run(name, now, fileId);
      fileEvent(
        db,
        fileId,
        profile,
        "renamed",
        { displayName: before.display_name },
        { displayName: name },
      );
    }
    if (
      edits.folderId !== undefined &&
      edits.folderId !== before.managed_folder_id
    ) {
      db.prepare(
        "UPDATE library_file_metadata SET managed_folder_id=?,updated_at=? WHERE file_id=?",
      ).run(edits.folderId, now, fileId);
      fileEvent(
        db,
        fileId,
        profile,
        "moved",
        { folderId: before.managed_folder_id },
        { folderId: edits.folderId },
      );
    }
    rebuildSearchIndex(db);
    return { id: fileId };
  });
}
export function setTrashed(
  profile: DemoProfileId,
  fileId: string,
  trashed: boolean,
  db = openDatabase(),
) {
  return transaction(db, () => {
    const caps = fileCapabilities(profile, fileId, db);
    const file = db
      .prepare(
        "SELECT origin,trashed_at,managed_folder_id,collection_id FROM library_file_metadata WHERE file_id=?",
      )
      .get(fileId) as
      | {
          origin: string;
          trashed_at: string | null;
          managed_folder_id: string | null;
          collection_id: string;
        }
      | undefined;
    if (!file || !caps?.canRead)
      throw new FileInputError("Archivo no disponible.", 404);
    if (!caps.canEdit || file.origin !== "managed_upload")
      throw new FileInputError(
        "Este archivo no se puede enviar a la papelera ni restaurar.",
        403,
      );
    if (Boolean(file.trashed_at) === trashed) return { id: fileId };
    let folder = file.managed_folder_id;
    if (
      folder &&
      !db
        .prepare(
          "SELECT id FROM managed_folders WHERE id=? AND collection_id=?",
        )
        .get(folder, file.collection_id)
    )
      folder = null;
    db.prepare(
      "UPDATE library_file_metadata SET trashed_at=?,managed_folder_id=?,updated_at=? WHERE file_id=?",
    ).run(
      trashed ? new Date().toISOString() : null,
      folder,
      new Date().toISOString(),
      fileId,
    );
    fileEvent(
      db,
      fileId,
      profile,
      trashed ? "trashed" : "restored",
      { trashed: !trashed },
      { trashed },
    );
    return { id: fileId };
  });
}
export function resetSamples(profile: DemoProfileId, db = openDatabase()) {
  if (profile !== "system-administrator")
    throw new FileInputError(
      "Solo el administrador del sistema puede restablecer ejemplos.",
      403,
    );
  transaction(db, () => {
    db.exec(
      "DELETE FROM file_relations WHERE from_file_id IN (SELECT file_id FROM library_file_metadata WHERE sample_owned=1 AND origin='managed_upload') OR to_file_id IN (SELECT file_id FROM library_file_metadata WHERE sample_owned=1 AND origin='managed_upload')",
    );
    db.exec(
      "DELETE FROM files WHERE id IN (SELECT file_id FROM library_file_metadata WHERE sample_owned=1 AND origin='managed_upload')",
    );
  });
  resetDemoFixtures(db);
}
