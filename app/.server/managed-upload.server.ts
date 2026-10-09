import { createHash, randomUUID } from "node:crypto";
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
import { reconcileFileEvidence } from "./collection-evidence.server";
import { applyCollectionRuleDefaultsInTransaction } from "./collection-rule-defaults.server";

export async function saveManagedUpload(
  profileId: DemoProfileId,
  input: {
    collectionId: string;
    file: File;
    folderId?: string | null;
    projectIds?: string[];
    operation?: { key: string; runId?: string; stepKey?: string };
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
  const operationKey = input.operation?.key;
  if (operationKey !== undefined && (!/^[A-Za-z0-9._:-]{8,128}$/.test(operationKey) || Boolean(input.operation?.runId) !== Boolean(input.operation?.stepKey)))
    throw new FileInputError("Identificador de operación inválido.");
  const payloadFingerprint = createHash("sha256").update(JSON.stringify({
    collectionId: input.collectionId, folderId: input.folderId ?? null, projectIds, filename,
    bytes: createHash("sha256").update(bytes).digest("hex"),
  })).digest("hex");
  if (input.operation?.runId && input.operation.stepKey) {
    const step = db.prepare(`SELECT s.action_type,s.state,r.profile_id FROM agent_steps s JOIN agent_runs r ON r.id=s.run_id WHERE s.run_id=? AND s.step_key=?`).get(input.operation.runId, input.operation.stepKey) as { action_type: string; state: string; profile_id: string } | undefined;
    if (!step || step.profile_id !== profileId || step.action_type !== "upload" || !["queued", "running", "succeeded"].includes(step.state))
      throw new FileInputError("La operación ya no está disponible.", 409);
  }
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
    const upload = transaction(db, () => {
      if (
        !collectionCapabilities(profileId, input.collectionId, db).canContribute
      )
        throw new FileInputError("Upload destination is not permitted.", 403);
      validateFolder(input.collectionId, input.folderId ?? null, db);
      validateProjectLinks(profileId, projectIds, db);
      if (operationKey) {
        const existing = db.prepare("SELECT payload_fingerprint,file_id,run_id,step_key FROM agent_upload_operations WHERE profile_id=? AND operation_key=?").get(profileId, operationKey) as { payload_fingerprint: string; file_id: string; run_id: string | null; step_key: string | null } | undefined;
        if (existing) {
          if (existing.payload_fingerprint !== payloadFingerprint) throw new FileInputError("El identificador ya se usó con otro archivo.", 409);
          const sameExplicitRun = (input.operation?.runId ?? null) === existing.run_id && (input.operation?.stepKey ?? null) === existing.step_key;
          const sameDirectIntake = !input.operation?.runId && Boolean(existing.run_id) && existing.step_key === "attach";
          if (!sameExplicitRun && !sameDirectIntake)
            throw new FileInputError("El identificador pertenece a otra operación.", 409);
          const prior = db.prepare("SELECT id,filename,size_bytes FROM files WHERE id=?").get(existing.file_id) as { id: string; filename: string; size_bytes: number } | undefined;
          if (!prior) throw new FileInputError("El resultado de la operación no está disponible.", 409);
          return { id: prior.id, filename: prior.filename, sizeBytes: prior.size_bytes, duplicateName: false, idempotentReplay: true, organizationDefaults: { status: "replayed" as const, ruleIds: [] } };
        }
        if (input.operation?.runId && input.operation.stepKey) {
          const step = db.prepare("SELECT action_type,state FROM agent_steps WHERE run_id=? AND step_key=?").get(input.operation.runId, input.operation.stepKey) as { action_type: string; state: string } | undefined;
          if (!step || step.action_type !== "upload" || !["queued", "running"].includes(step.state))
            throw new FileInputError("La operación ya no está disponible.", 409);
        }
      }
      const duplicateName = Boolean(
        db
          .prepare(
            "SELECT 1 FROM library_file_metadata WHERE collection_id=? AND display_name=? AND trashed_at IS NULL",
          )
          .get(input.collectionId, filename),
      );
      const timestamp = new Date().toISOString();
      const fileId = randomUUID();
      const directRunId = operationKey && !input.operation?.runId ? randomUUID() : null;
      const directStepKey = directRunId ? "attach" : null;
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
      if (directRunId) db.prepare(
        "INSERT INTO agent_runs (id,profile_id,collection_id,provider_version,intent,status,request_key,request_fingerprint,started_at,finished_at,created_at) VALUES (?,?,?,'direct-intake-v1',?,'completed',?,?,?,?,?)",
      ).run(directRunId, profileId, input.collectionId, JSON.stringify({ type: "upload", collectionId: input.collectionId, projectIds, filename }), `direct-upload:${operationKey}`, payloadFingerprint, timestamp, timestamp, timestamp);
      fileEvent(db, fileId, profileId, "uploaded", null, {
        filename,
        sizeBytes: bytes.length,
        collectionId: input.collectionId,
        folderId: input.folderId ?? null,
        projectIds,
      }, directRunId && directStepKey ? { runId: directRunId, stepKey: directStepKey } : undefined);
      const organizationDefaults = applyCollectionRuleDefaultsInTransaction(profileId, {
        id: fileId, collectionId: input.collectionId, filename, extension,
        projectIds, folderExplicit: Boolean(input.folderId),
      }, db);
      if (operationKey) {
        db.prepare("INSERT INTO agent_upload_operations (profile_id,operation_key,payload_fingerprint,file_id,run_id,step_key,created_at) VALUES (?,?,?,?,?,?,?)")
          .run(profileId, operationKey, payloadFingerprint, fileId, input.operation?.runId ?? directRunId, input.operation?.stepKey ?? directStepKey, timestamp);
        if (directRunId && directStepKey) db.prepare(
          "INSERT INTO agent_steps (id,run_id,step_key,action_type,target_ids_json,target_fingerprint,state,reason,result_json,idempotency_key,created_at,updated_at) VALUES (?,?,?,'upload',?,?, 'succeeded',?,?, ?,?,?)",
        ).run(randomUUID(), directRunId, directStepKey, JSON.stringify([fileId]), payloadFingerprint, "Archivo adjuntado directamente por el usuario", JSON.stringify({ fileId, filename, sizeBytes: bytes.length }), `${profileId}:${operationKey}`, timestamp, timestamp);
        if (input.operation?.runId && input.operation.stepKey) {
          const stepResult = JSON.stringify({ fileId, filename, sizeBytes: bytes.length });
          db.prepare("UPDATE agent_steps SET state='succeeded',result_json=?,idempotency_key=?,target_fingerprint=?,updated_at=? WHERE run_id=? AND step_key=? AND state IN ('queued','running')")
            .run(stepResult, `${profileId}:${operationKey}`, payloadFingerprint, timestamp, input.operation.runId, input.operation.stepKey);
          db.prepare("UPDATE agent_runs SET status='completed',finished_at=? WHERE id=? AND profile_id=? AND NOT EXISTS (SELECT 1 FROM agent_steps WHERE run_id=? AND state NOT IN ('succeeded','skipped'))")
            .run(timestamp, input.operation.runId, profileId, input.operation.runId);
        }
      }
      rebuildSearchIndex(db);
      return { id: fileId, filename, sizeBytes: bytes.length, duplicateName, idempotentReplay: false, organizationDefaults };
    });
    if (upload.idempotentReplay) {
      await fs.rm(object, { force: true });
      objectOwned = false;
    }
    let evidence: ReturnType<typeof reconcileFileEvidence> | { status: "pending" };
    try {
      evidence = reconcileFileEvidence(upload.id, "uploaded", db);
    } catch {
      // The durable upload remains successful; a later replay repairs evidence linking.
      evidence = { status: "pending" };
    }
    const { idempotentReplay: _idempotentReplay, ...publicUpload } = upload;
    return { ...publicUpload, evidence };
  } catch (error) {
    if (stagedOwned) await fs.rm(staged, { force: true });
    if (objectOwned) await fs.rm(object, { force: true });
    throw error;
  }
}
