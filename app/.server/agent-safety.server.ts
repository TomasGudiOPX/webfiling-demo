import type { DatabaseSync } from "node:sqlite";
import type { DemoProfileId } from "../types";
import { canReadFile, collectionCapabilities, fileCapabilities } from "./file-access.server";
import { canReadAgentRun } from "./agent-access.server";
import { openDatabase } from "./db.server";

export type DemoAgentOperation =
  | { type: "upload"; collectionId: string; folderId?: string | null; projectIds?: string[] }
  | { type: "organize"; fileId: string; categoryId?: string | null; disciplineTag?: string | null; locationTag?: string | null; folderId?: string | null; projectIds?: string[] }
  | { type: "summarize"; fileIds: string[] }
  | { type: "summarize_collection"; collectionId: string }
  | { type: "check_collection"; collectionId: string }
  | { type: "draft_rule"; collectionId: string; recipientProfileId: DemoProfileId };

const profiles = new Set<DemoProfileId>([
  "employee", "manager", "administration-staff", "system-administrator",
]);
const categories = new Set([
  "contracts", "finance", "technical", "progress-quality", "logistics",
  "people-safety", "subcontractors",
]);
const disciplines = new Set([
  "architecture", "structures", "finance", "quality", "logistics", "safety",
  "procurement", "project-management",
]);
const locations = new Set([
  "whole-site", "north-sector", "tower-a", "facade", "level-07", "site-access",
]);

export class AgentInputError extends Error {
  constructor(readonly code: "invalid_operation" | "not_found" | "forbidden", readonly status: 400 | 403 | 404) {
    super(code === "not_found" ? "Recurso no disponible." : code === "forbidden" ? "Acción no permitida." : "La acción no es válida.");
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AgentInputError("invalid_operation", 400);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new AgentInputError("invalid_operation", 400);
}
function id(value: unknown, optional = false): string | null | undefined {
  if (optional && value === undefined) return undefined;
  if (optional && value === null) return null;
  if (typeof value !== "string" || value.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))
    throw new AgentInputError("invalid_operation", 400);
  return value;
}
function ids(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) throw new AgentInputError("invalid_operation", 400);
  const result = value.map((entry) => id(entry) as string);
  if (new Set(result).size !== result.length) throw new AgentInputError("invalid_operation", 400);
  return result;
}
function enumValue(value: unknown, allowed: Set<string>, optional = true): string | null | undefined {
  if (optional && value === undefined) return undefined;
  if (optional && value === null) return null;
  if (typeof value !== "string" || !allowed.has(value)) throw new AgentInputError("invalid_operation", 400);
  return value;
}

/** Strict allowlist parser; actor/profile authority always comes from the signed request context. */
export function parseDemoAgentOperation(input: unknown): DemoAgentOperation {
  const value = record(input);
  switch (value.type) {
    case "upload":
      exactKeys(value, ["type", "collectionId", "folderId", "projectIds"]);
      return {
        type: "upload",
        collectionId: id(value.collectionId)!,
        ...(value.folderId !== undefined ? { folderId: id(value.folderId, true)! } : {}),
        ...(value.projectIds !== undefined ? { projectIds: ids(value.projectIds)! } : {}),
      };
    case "organize":
      exactKeys(value, ["type", "fileId", "categoryId", "disciplineTag", "locationTag", "folderId", "projectIds"]);
      return {
        type: "organize",
        fileId: id(value.fileId)!,
        ...(value.categoryId !== undefined ? { categoryId: enumValue(value.categoryId, categories)! } : {}),
        ...(value.disciplineTag !== undefined ? { disciplineTag: enumValue(value.disciplineTag, disciplines)! } : {}),
        ...(value.locationTag !== undefined ? { locationTag: enumValue(value.locationTag, locations)! } : {}),
        ...(value.folderId !== undefined ? { folderId: id(value.folderId, true)! } : {}),
        ...(value.projectIds !== undefined ? { projectIds: ids(value.projectIds)! } : {}),
      } as DemoAgentOperation;
    case "summarize": {
      exactKeys(value, ["type", "fileIds"]);
      const fileIds = ids(value.fileIds);
      if (!fileIds?.length) throw new AgentInputError("invalid_operation", 400);
      return { type: "summarize", fileIds };
    }
    case "summarize_collection":
      exactKeys(value, ["type", "collectionId"]);
      return { type: "summarize_collection", collectionId: id(value.collectionId)! };
    case "check_collection":
      exactKeys(value, ["type", "collectionId"]);
      return { type: "check_collection", collectionId: id(value.collectionId)! };
    case "draft_rule": {
      exactKeys(value, ["type", "collectionId", "recipientProfileId"]);
      const recipientProfileId = value.recipientProfileId;
      if (typeof recipientProfileId !== "string" || !profiles.has(recipientProfileId as DemoProfileId))
        throw new AgentInputError("invalid_operation", 400);
      return { type: "draft_rule", collectionId: id(value.collectionId)!, recipientProfileId: recipientProfileId as DemoProfileId };
    }
    default:
      throw new AgentInputError("invalid_operation", 400);
  }
}

const safeErrorMessages: Record<string, string> = {
  invalid_operation: "La acción no es válida.",
  stale_target: "El archivo cambió. Actualiza el plan antes de aplicarlo.",
  permission_changed: "El recurso ya no está disponible para este perfil.",
  not_found: "Recurso no disponible.",
  forbidden: "Acción no permitida.",
  unavailable: "No se pudo completar la acción. Puedes intentarlo de nuevo.",
};

export function safeAgentError(error: unknown) {
  const code = error instanceof AgentInputError ? error.code : "unavailable";
  return { code, message: safeErrorMessages[code] ?? safeErrorMessages.unavailable };
}

export function assertAgentFileCapability(
  profileId: DemoProfileId,
  fileId: string,
  capability: "read" | "edit",
  db: DatabaseSync = openDatabase(),
): void {
  const access = fileCapabilities(profileId, fileId, db);
  if (!access || !access.canRead) throw new AgentInputError("not_found", 404);
  if (capability === "edit" && !access.canEdit)
    throw new AgentInputError("forbidden", 403);
}

export function assertAgentCollectionCapability(
  profileId: DemoProfileId,
  collectionId: string,
  capability: "read" | "contribute" | "organize",
  db: DatabaseSync = openDatabase(),
): void {
  const access = collectionCapabilities(profileId, collectionId, db);
  if (!access.canRead) throw new AgentInputError("not_found", 404);
  if (capability === "contribute" && !access.canContribute)
    throw new AgentInputError("forbidden", 403);
  if (capability === "organize" && !access.canOrganize)
    throw new AgentInputError("forbidden", 403);
}

/** Returns only owner-private history and drops any cached source text no longer readable. */
export function readableAgentHistory(
  profileId: DemoProfileId,
  runId: string,
  db: DatabaseSync = openDatabase(),
) {
  if (!canReadAgentRun(profileId, runId, db)) throw new AgentInputError("not_found", 404);
  const run = db.prepare(
    `SELECT id,provider_version,intent,status,safe_error_code,created_at,started_at,finished_at
     FROM agent_runs WHERE id=? AND profile_id=?`,
  ).get(runId, profileId) as {
    id: string; provider_version: string; intent: string; status: string;
    safe_error_code: string | null; created_at: string; started_at: string | null; finished_at: string | null;
  };
  const steps = db.prepare(
    `SELECT id,step_key,action_type,target_ids_json,state,reason,result_json,created_at,updated_at
     FROM agent_steps WHERE run_id=? ORDER BY created_at,id`,
  ).all(runId) as Array<{
    id: string; step_key: string; action_type: string; target_ids_json: string; state: string;
    reason: string; result_json: string | null; created_at: string; updated_at: string;
  }>;
  const visibleSteps = steps.flatMap((step) => {
    let targetIds: unknown;
    try { targetIds = JSON.parse(step.target_ids_json); } catch { return []; }
    if (!Array.isArray(targetIds) || targetIds.some((target) => typeof target !== "string")) return [];
    const fileIds = targetIds.filter((target) => {
      const row = db.prepare("SELECT 1 FROM files WHERE id=?").get(target);
      return Boolean(row);
    });
    const hiddenFiles = fileIds.some((fileId) => !canReadFile(profileId, fileId, db));
    if (hiddenFiles) return [];
    let outcome: string | null = null;
    try {
      const stored = step.result_json ? record(JSON.parse(step.result_json)) : null;
      const candidate = stored?.outcome;
      if (candidate === "succeeded" || candidate === "partial" || candidate === "failed") outcome = candidate;
    } catch { outcome = null; }
    return [{ id: step.id, action: step.action_type, state: step.state, reason: step.reason, outcome, createdAt: step.created_at, updatedAt: step.updated_at }];
  });
  const summaries = db.prepare(
    `SELECT s.id,s.file_id,s.extraction_method,s.excerpt_text,s.truncated,s.created_at,
            s.source_file_updated_at,s.source_metadata_updated_at,f.updated_at,m.updated_at AS metadata_updated_at
     FROM agent_summaries s JOIN files f ON f.id=s.file_id JOIN library_file_metadata m ON m.file_id=s.file_id
     WHERE s.run_id=? ORDER BY s.created_at,s.id`,
  ).all(runId) as Array<{
    id: string; file_id: string; extraction_method: string; excerpt_text: string; truncated: number; created_at: string;
    source_file_updated_at: string; source_metadata_updated_at: string; updated_at: string; metadata_updated_at: string;
  }>;
  const visibleSummaries = summaries.flatMap((summary) => {
    if (!canReadFile(profileId, summary.file_id, db) || summary.source_file_updated_at !== summary.updated_at || summary.source_metadata_updated_at !== summary.metadata_updated_at) return [];
    return [{ id: summary.id, fileId: summary.file_id, method: summary.extraction_method, text: summary.excerpt_text, truncated: Boolean(summary.truncated), createdAt: summary.created_at }];
  });
  return {
    id: run.id,
    providerVersion: run.provider_version,
    intent: run.intent,
    status: run.status,
    error: run.safe_error_code
      ? {
          code: Object.hasOwn(safeErrorMessages, run.safe_error_code) ? run.safe_error_code : "unavailable",
          message: safeErrorMessages[run.safe_error_code] ?? safeErrorMessages.unavailable,
        }
      : null,
    createdAt: run.created_at,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    steps: visibleSteps,
    summaries: visibleSummaries,
  };
}

export function listReadableAgentHistory(profileId: DemoProfileId, db: DatabaseSync = openDatabase(), limit = 30) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new AgentInputError("invalid_operation", 400);
  const rows = db.prepare("SELECT id FROM agent_runs WHERE profile_id=? ORDER BY created_at DESC,id DESC LIMIT ?").all(profileId, limit) as Array<{ id: string }>;
  return rows.flatMap(({ id }) => {
    try { return [readableAgentHistory(profileId, id, db)]; }
    catch { return []; }
  });
}
