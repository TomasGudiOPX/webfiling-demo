import type { DatabaseSync } from "node:sqlite";
import type { DemoProfileId } from "../types";
import { openDatabase } from "./db.server";

export interface CollectionCapabilities {
  canRead: boolean;
  canContribute: boolean;
  canOrganize: boolean;
  canResetSamples: boolean;
}

export interface FileCapabilities extends CollectionCapabilities {
  canEditOwnUpload: boolean;
  canEdit: boolean;
}

export function readableFileIds(
  profileId: DemoProfileId,
  db: DatabaseSync = openDatabase(),
): string[] {
  return (
    db.prepare(
      `SELECT m.file_id
       FROM library_file_metadata m
       JOIN collection_grants g ON g.collection_id=m.collection_id
       WHERE g.profile_id=? AND g.can_read=1 AND m.trashed_at IS NULL`,
    ).all(profileId) as Array<{ file_id: string }>
  ).map((row) => row.file_id);
}

export function canReadFile(
  profileId: DemoProfileId,
  fileId: string,
  db: DatabaseSync = openDatabase(),
): boolean {
  return readableFileIds(profileId, db).includes(fileId);
}

export function collectionCapabilities(
  profileId: DemoProfileId,
  collectionId: string,
  db: DatabaseSync = openDatabase(),
): CollectionCapabilities {
  const grant = db.prepare(
    "SELECT can_read,can_contribute,can_organize FROM collection_grants WHERE profile_id=? AND collection_id=?",
  ).get(profileId, collectionId) as {
    can_read: number;
    can_contribute: number;
    can_organize: number;
  } | undefined;
  const isSystemAdministrator = profileId === "system-administrator";
  return {
    canRead: Boolean(grant?.can_read),
    canContribute: Boolean(grant?.can_contribute),
    canOrganize: Boolean(grant?.can_organize),
    canResetSamples: isSystemAdministrator,
  };
}

export function fileCapabilities(
  profileId: DemoProfileId,
  fileId: string,
  db: DatabaseSync = openDatabase(),
): FileCapabilities | null {
  const file = db.prepare(
    "SELECT collection_id,origin,contributor_id FROM library_file_metadata WHERE file_id=?",
  ).get(fileId) as {
    collection_id: string;
    origin: string;
    contributor_id: string | null;
  } | undefined;
  if (!file) return null;
  const collection = collectionCapabilities(profileId, file.collection_id, db);
  const canEditOwnUpload =
    collection.canContribute &&
    file.origin === "managed_upload" &&
    file.contributor_id === profileId;
  return {
    ...collection,
    canEditOwnUpload,
    canEdit: collection.canOrganize || canEditOwnUpload,
  };
}
