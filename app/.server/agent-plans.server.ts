import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DemoProfileId } from "../types";
import { assertAgentCollectionCapability, assertAgentFileCapability, parseDemoAgentOperation, type DemoAgentOperation } from "./agent-safety.server";
import { openDatabase } from "./db.server";
import { getConfig } from "./config";
import { transaction } from "./sqlite-transaction.server";
import { editLibraryFile } from "./library-management.server";
import { extractGroundedSummarySource, type ExtractedSummarySource } from "./summary-extraction.server";
import { canReadFile } from "./file-access.server";
import { createCollectionRuleInTransaction } from "./collection-rules.server";

export class AgentPlanError extends Error {
  constructor(readonly code: "invalid_operation" | "not_found" | "forbidden" | "stale_plan" | "plan_expired" | "unsupported_action", readonly status: 400 | 403 | 404 | 409 | 501) { super(code); }
}

type GroundedSummaryResult = {
  status: "completed" | "partial";
  coverage: { requested: number; available: number; unavailable: number; capped: boolean };
  sources: Array<{
    fileId: string; filename: string; fingerprint: string; extractionMethod: string;
    summaryText: string; truncated: boolean; notice: string | null;
  }>;
};

function targetInfo(profileId: DemoProfileId, operation: DemoAgentOperation, db: DatabaseSync) {
  let collectionId: string | null = null;
  let targetIds: string[] = [];
  const additionalFingerprintData: unknown[] = [];
  if (operation.type === "upload") {
    assertAgentCollectionCapability(profileId, operation.collectionId, "contribute", db);
    collectionId = operation.collectionId;
    targetIds = [operation.collectionId];
  } else if (operation.type === "check_collection" || operation.type === "summarize_collection" || operation.type === "draft_rule") {
    if (operation.type === "draft_rule" && profileId !== "system-administrator") throw new AgentPlanError("forbidden", 403);
    assertAgentCollectionCapability(profileId, operation.collectionId, operation.type === "draft_rule" ? "organize" : "read", db);
    collectionId = operation.collectionId;
    targetIds = [operation.collectionId];
    if (operation.type === "summarize_collection") {
      const files = db.prepare("SELECT f.id FROM files f JOIN library_file_metadata m ON m.file_id=f.id WHERE m.collection_id=? AND m.trashed_at IS NULL ORDER BY f.id LIMIT 501").all(collectionId) as Array<{ id: string }>;
      targetIds.push(...files.filter((file) => canReadFile(profileId, file.id, db)).slice(0, 500).map((file) => file.id));
      additionalFingerprintData.push({ visibleFileScanCount: files.length, capped: files.length > 500 });
    }
  } else if (operation.type === "organize") {
    assertAgentFileCapability(profileId, operation.fileId, "edit", db);
    targetIds = [operation.fileId];
  } else {
    targetIds = operation.fileIds;
    for (const fileId of operation.fileIds) assertAgentFileCapability(profileId, fileId, "read", db);
  }
  const rows: unknown[] = collectionId
    ? [db.prepare("SELECT c.id,c.updated_at,g.can_read,g.can_contribute,g.can_organize FROM collections c LEFT JOIN collection_grants g ON g.collection_id=c.id AND g.profile_id=? WHERE c.id=?").get(profileId, collectionId)]
    : [];
  const fileTargets = collectionId && operation.type === "summarize_collection" ? targetIds.slice(1) : collectionId ? [] : targetIds;
  rows.push(...fileTargets.map((id) => db.prepare(
      `SELECT f.id,f.filename,f.updated_at,f.category_id,f.discipline_tag,f.location_tag,m.collection_id,m.managed_folder_id,m.trashed_at,m.updated_at AS metadata_updated_at,
         (SELECT group_concat(project_id,',') FROM (SELECT project_id FROM file_projects WHERE file_id=f.id ORDER BY project_id)) AS projects
       FROM files f JOIN library_file_metadata m ON m.file_id=f.id WHERE f.id=?`,
    ).get(id)));
  rows.push(...additionalFingerprintData);
  if (rows.some((row) => !row)) throw new AgentPlanError("not_found", 404);
  return { collectionId, targetIds, targetFingerprint: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
}

export function createAgentPlan(profileId: DemoProfileId, providerVersion: string, intent: string, operationInput: unknown, reason: string, db = openDatabase(), now = new Date()) {
  if (!getConfig().demoMode) throw new AgentPlanError("not_found", 404);
  if (intent.length > 500 || reason.length > 500 || providerVersion !== "demo-intents-v1") throw new AgentPlanError("invalid_operation", 400);
  const operation = parseDemoAgentOperation(operationInput);
  const target = targetInfo(profileId, operation, db);
  const id = randomUUID();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
  db.prepare("INSERT INTO agent_plans (id,profile_id,provider_version,operation_json,reason,target_fingerprint,status,expires_at,created_at) VALUES (?,?,?,?,?,?,'ready',?,?)")
    .run(id, profileId, providerVersion, JSON.stringify(operation), reason, target.targetFingerprint, expiresAt, createdAt);
  return { id, providerVersion, operation, reason, targetIds: target.targetIds, expiresAt };
}

export function applyAgentPlan(profileId: DemoProfileId, planId: string, db = openDatabase(), now = new Date()) {
  if (!getConfig().demoMode) throw new AgentPlanError("not_found", 404);
  return transaction(db, () => {
    const plan = db.prepare("SELECT * FROM agent_plans WHERE id=? AND profile_id=?").get(planId, profileId) as {
      id: string; provider_version: string; operation_json: string; reason: string; target_fingerprint: string;
      status: string; expires_at: string;
    } | undefined;
    if (!plan) throw new AgentPlanError("not_found", 404);
    if (plan.status !== "ready") throw new AgentPlanError("stale_plan", 409);
    if (new Date(plan.expires_at).getTime() <= now.getTime()) {
      throw new AgentPlanError("plan_expired", 409);
    }
    const operation = parseDemoAgentOperation(JSON.parse(plan.operation_json));
    const target = targetInfo(profileId, operation, db);
    if (target.targetFingerprint !== plan.target_fingerprint) {
      throw new AgentPlanError("stale_plan", 409);
    }
    const runId = randomUUID();
    const at = now.toISOString();
    db.prepare("INSERT INTO agent_runs (id,profile_id,collection_id,provider_version,intent,status,created_at) VALUES (?,?,?,?,?,'queued',?)")
      .run(runId, profileId, target.collectionId, plan.provider_version, JSON.stringify(operation), at);
    db.prepare("INSERT INTO agent_steps (id,run_id,step_key,action_type,target_ids_json,target_fingerprint,state,reason,created_at,updated_at) VALUES (?,?,?,?,?,?,'queued',?,?,?)")
      .run(randomUUID(), runId, "apply", operation.type, JSON.stringify(target.targetIds), target.targetFingerprint, plan.reason, at, at);
    db.prepare("UPDATE agent_plans SET status='applied',applied_run_id=? WHERE id=?").run(runId, plan.id);
    return { runId, status: "queued" as const };
  });
}

export function executeAgentOrganizationStep(profileId: DemoProfileId, runId: string, stepKey: string, db = openDatabase(), now = new Date()) {
  const task = transaction(db, () => {
    const run = db.prepare("SELECT profile_id,intent,status FROM agent_runs WHERE id=?").get(runId) as { profile_id: DemoProfileId; intent: string; status: string } | undefined;
    const step = db.prepare("SELECT action_type,state,target_ids_json,target_fingerprint FROM agent_steps WHERE run_id=? AND step_key=?").get(runId, stepKey) as { action_type: string; state: string; target_ids_json: string; target_fingerprint: string | null } | undefined;
    if (!run || run.profile_id !== profileId || !step) throw new AgentPlanError("not_found", 404);
    if (step.state === "succeeded") {
      const saved = db.prepare("SELECT result_json FROM agent_steps WHERE run_id=? AND step_key=?").get(runId, stepKey) as { result_json: string | null } | undefined;
      return { completed: true as const, fileId: (JSON.parse(saved?.result_json ?? "{}") as { fileId?: string }).fileId };
    }
    if (step.action_type !== "organize") throw new AgentPlanError("unsupported_action", 501);
    const operation = parseDemoAgentOperation(JSON.parse(run.intent));
    if (operation.type !== "organize") throw new AgentPlanError("invalid_operation", 400);
    if (step.state === "failed") {
      const event = db.prepare("SELECT 1 FROM file_events WHERE file_id=? AND agent_run_id=? AND agent_step_key=? LIMIT 1").get(operation.fileId, runId, stepKey);
      const current = db.prepare("SELECT f.category_id,f.discipline_tag,f.location_tag,m.managed_folder_id FROM files f JOIN library_file_metadata m ON m.file_id=f.id WHERE f.id=?").get(operation.fileId) as { category_id: string | null; discipline_tag: string | null; location_tag: string | null; managed_folder_id: string | null } | undefined;
      const applied = Boolean(event && current &&
        (operation.categoryId === undefined || current.category_id === operation.categoryId) &&
        (operation.disciplineTag === undefined || current.discipline_tag === operation.disciplineTag) &&
        (operation.locationTag === undefined || current.location_tag === operation.locationTag) &&
        (operation.folderId === undefined || current.managed_folder_id === operation.folderId));
      if (!applied) throw new AgentPlanError("unsupported_action", 501);
      const at = now.toISOString();
      db.prepare("UPDATE agent_steps SET state='succeeded',result_json=?,updated_at=? WHERE run_id=? AND step_key=?").run(JSON.stringify({ fileId: operation.fileId, status: "organized" }), at, runId, stepKey);
      db.prepare("UPDATE agent_runs SET status='completed',safe_error_code=NULL,finished_at=? WHERE id=?").run(at, runId);
      return { completed: true as const, fileId: operation.fileId };
    }
    if (!["queued", "running"].includes(step.state)) throw new AgentPlanError("unsupported_action", 501);
    const target = targetInfo(profileId, operation, db);
    if (target.targetFingerprint !== step.target_fingerprint) throw new AgentPlanError("stale_plan", 409);
    db.prepare("UPDATE agent_steps SET state='running',updated_at=? WHERE run_id=? AND step_key=?").run(now.toISOString(), runId, stepKey);
    db.prepare("UPDATE agent_runs SET status='running',started_at=COALESCE(started_at,?) WHERE id=?").run(now.toISOString(), runId);
    return { completed: false as const, operation };
  });
  if (task.completed) return { status: "completed" as const, fileId: task.fileId };
  const { operation } = task;
  if (operation.type !== "organize") throw new AgentPlanError("invalid_operation", 400);
  const { type: _type, fileId, disciplineTag, locationTag, ...operationEdits } = operation;
  try {
    editLibraryFile(profileId, fileId, {
      ...operationEdits,
      ...(disciplineTag !== undefined ? { discipline: disciplineTag } : {}),
      ...(locationTag !== undefined ? { location: locationTag } : {}),
    }, db, { runId, stepKey });
    transaction(db, () => {
      const at = now.toISOString();
      db.prepare("UPDATE agent_steps SET state='succeeded',result_json=?,updated_at=? WHERE run_id=? AND step_key=? AND state='running'")
        .run(JSON.stringify({ fileId, status: "organized" }), at, runId, stepKey);
      db.prepare("UPDATE agent_runs SET status='completed',finished_at=? WHERE id=? AND NOT EXISTS (SELECT 1 FROM agent_steps WHERE run_id=? AND state NOT IN ('succeeded','skipped'))")
        .run(at, runId, runId);
    });
    return { status: "completed" as const, fileId };
  } catch {
    transaction(db, () => {
      const at = now.toISOString();
      db.prepare("UPDATE agent_steps SET state='failed',result_json=?,updated_at=? WHERE run_id=? AND step_key=? AND state='running'")
        .run(JSON.stringify({ code: "unavailable" }), at, runId, stepKey);
      db.prepare("UPDATE agent_runs SET status='failed',safe_error_code='unavailable',finished_at=? WHERE id=?")
        .run(at, runId);
    });
    throw new AgentPlanError("unsupported_action", 501);
  }
}

export function executeAgentRuleDraftStep(profileId: DemoProfileId, runId: string, stepKey: string, db = openDatabase(), now = new Date()) {
  if (!getConfig().demoMode) throw new AgentPlanError("not_found", 404);
  return transaction(db, () => {
    const run = db.prepare("SELECT profile_id,intent FROM agent_runs WHERE id=?").get(runId) as { profile_id: DemoProfileId; intent: string } | undefined;
    const step = db.prepare("SELECT action_type,state,target_fingerprint,result_json FROM agent_steps WHERE run_id=? AND step_key=?").get(runId, stepKey) as {
      action_type: string; state: string; target_fingerprint: string | null; result_json: string | null;
    } | undefined;
    if (!run || run.profile_id !== profileId || !step) throw new AgentPlanError("not_found", 404);
    if (step.state === "succeeded") return JSON.parse(step.result_json ?? "{}") as Record<string, unknown>;
    if (step.action_type !== "draft_rule" || !["queued", "running"].includes(step.state)) throw new AgentPlanError("unsupported_action", 501);
    const operation = parseDemoAgentOperation(JSON.parse(run.intent));
    if (operation.type !== "draft_rule") throw new AgentPlanError("invalid_operation", 400);
    const target = targetInfo(profileId, operation, db);
    if (target.targetFingerprint !== step.target_fingerprint) throw new AgentPlanError("stale_plan", 409);
    const start = new Date(now.getTime() + 24 * 60 * 60_000);
    const end = new Date(start.getTime() + 24 * 60 * 60_000);
    const rule = createCollectionRuleInTransaction(profileId, {
      recipientProfileId: operation.recipientProfileId,
      collectionId: operation.collectionId,
      projectId: null,
      definition: {
        recurrence: { kind: "one_off", timezone: "America/Argentina/Buenos_Aires", opensAt: start.toISOString(), closesAt: end.toISOString() },
        slots: [{ key: "documento", label: "Documento esperado", requiredCount: 1, allowedExtensions: [".pdf"], criteria: {} }],
        organizationDefaults: {},
      },
    }, db, now);
    const result = { status: "draft_created", ruleId: rule.id, version: rule.version, enabled: rule.enabled };
    const at = now.toISOString();
    db.prepare("UPDATE agent_steps SET state='succeeded',result_json=?,updated_at=? WHERE run_id=? AND step_key=?")
      .run(JSON.stringify(result), at, runId, stepKey);
    db.prepare("UPDATE agent_runs SET status='completed',finished_at=? WHERE id=?")
      .run(at, runId);
    return result;
  });
}

export async function executeAgentSummaryStep(profileId: DemoProfileId, runId: string, stepKey: string, db = openDatabase(), now = new Date()) {
  if (!getConfig().demoMode) throw new AgentPlanError("not_found", 404);
  const operation = transaction(db, () => {
    const run = db.prepare("SELECT profile_id,intent FROM agent_runs WHERE id=?").get(runId) as { profile_id: DemoProfileId; intent: string } | undefined;
    const step = db.prepare("SELECT action_type,state,target_fingerprint FROM agent_steps WHERE run_id=? AND step_key=?").get(runId, stepKey) as { action_type: string; state: string; target_fingerprint: string | null } | undefined;
    if (!run || run.profile_id !== profileId || !step) throw new AgentPlanError("not_found", 404);
    if (step.state === "succeeded") {
      const saved = db.prepare("SELECT result_json FROM agent_steps WHERE run_id=? AND step_key=?").get(runId, stepKey) as { result_json: string | null } | undefined;
      return { replay: true as const, result: JSON.parse(saved?.result_json ?? "{}") as GroundedSummaryResult };
    }
    if (!["summarize", "summarize_collection"].includes(step.action_type) || !["queued", "running"].includes(step.state)) throw new AgentPlanError("unsupported_action", 501);
    const parsed = parseDemoAgentOperation(JSON.parse(run.intent));
    if (parsed.type !== "summarize" && parsed.type !== "summarize_collection") throw new AgentPlanError("invalid_operation", 400);
    const target = targetInfo(profileId, parsed, db);
    if (target.targetFingerprint !== step.target_fingerprint) throw new AgentPlanError("stale_plan", 409);
    const readableCollectionFiles = parsed.type === "summarize_collection"
      ? (db.prepare("SELECT f.id FROM files f JOIN library_file_metadata m ON m.file_id=f.id WHERE m.collection_id=? AND m.trashed_at IS NULL ORDER BY f.id LIMIT 501").all(parsed.collectionId) as Array<{ id: string }>).filter((file) => canReadFile(profileId, file.id, db))
      : [];
    const fileIds = parsed.type === "summarize" ? parsed.fileIds : readableCollectionFiles.slice(0, 50).map((file) => file.id);
    const requestedCount = parsed.type === "summarize" ? parsed.fileIds.length : readableCollectionFiles.length;
    const capped = parsed.type === "summarize_collection" && readableCollectionFiles.length > 50;
    db.prepare("UPDATE agent_steps SET state='running',updated_at=? WHERE run_id=? AND step_key=?").run(now.toISOString(), runId, stepKey);
    db.prepare("UPDATE agent_runs SET status='running',started_at=COALESCE(started_at,?) WHERE id=?").run(now.toISOString(), runId);
    return { replay: false as const, parsed, fileIds, requestedCount, capped, fingerprint: target.targetFingerprint };
  });
  if (operation.replay) return operation.result;
  const sources: ExtractedSummarySource[] = [];
  for (const fileId of operation.fileIds) {
    const source = await extractGroundedSummarySource(profileId, fileId, db);
    if (source) sources.push(source);
  }
  return transaction(db, () => {
    for (const fileId of operation.fileIds) assertAgentFileCapability(profileId, fileId, "read", db);
    if (targetInfo(profileId, operation.parsed, db).targetFingerprint !== operation.fingerprint)
      throw new AgentPlanError("stale_plan", 409);
    const at = now.toISOString();
    for (const source of sources) {
      db.prepare("INSERT OR IGNORE INTO agent_summaries (id,run_id,file_id,source_fingerprint,source_file_updated_at,source_metadata_updated_at,extraction_method,excerpt_text,truncated,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(randomUUID(), runId, source.fileId, source.sourceFingerprint, source.sourceFileUpdatedAt, source.sourceMetadataUpdatedAt, source.extractionMethod, source.excerptText, source.truncated ? 1 : 0, at);
    }
    const status: GroundedSummaryResult["status"] = sources.length === operation.fileIds.length && !operation.capped ? "completed" : "partial";
    const result: GroundedSummaryResult = {
      status,
      coverage: { requested: operation.requestedCount, available: sources.length, unavailable: operation.requestedCount - sources.length, capped: operation.capped },
      sources: sources.map((source) => ({
        fileId: source.fileId, filename: source.filename, fingerprint: source.sourceFingerprint,
        extractionMethod: source.extractionMethod,
        summaryText: source.excerptText ? `Extracto del documento: ${source.excerptText}` : "El documento no contiene texto extraíble.",
        truncated: source.truncated,
        notice: source.truncated ? "Extracto limitado; no representa el documento completo." : null,
      })),
    };
    db.prepare("UPDATE agent_steps SET state='succeeded',result_json=?,updated_at=? WHERE run_id=? AND step_key=? AND state='running'")
      .run(JSON.stringify(result), at, runId, stepKey);
    db.prepare("UPDATE agent_runs SET status=?,finished_at=? WHERE id=?").run(status === "partial" ? "partial" : "completed", at, runId);
    return result;
  });
}

export async function executeScheduledCollectionSummary(profileId: DemoProfileId, collectionId: string, effectKey: string, db = openDatabase(), now = new Date()) {
  if (!/^[a-f0-9]{64}$/.test(effectKey)) throw new AgentPlanError("invalid_operation", 400);
  const runId = `scheduled-agent:${effectKey}`;
  transaction(db, () => {
    const existing = db.prepare("SELECT profile_id FROM agent_runs WHERE id=?").get(runId) as { profile_id: DemoProfileId } | undefined;
    if (existing) {
      if (existing.profile_id !== profileId) throw new AgentPlanError("not_found", 404);
      return;
    }
    const operation: DemoAgentOperation = { type: "summarize_collection", collectionId };
    const target = targetInfo(profileId, operation, db);
    const at = now.toISOString();
    db.prepare("INSERT INTO agent_runs (id,profile_id,collection_id,provider_version,intent,status,request_key,request_fingerprint,created_at) VALUES (?,?,?,?,?,'queued',?,?,?)")
      .run(runId, profileId, collectionId, "demo-intents-v1", JSON.stringify(operation), `scheduled:${effectKey}`, target.targetFingerprint, at);
    db.prepare("INSERT INTO agent_steps (id,run_id,step_key,action_type,target_ids_json,target_fingerprint,state,reason,created_at,updated_at) VALUES (?,?, 'summary','summarize_collection',?,?,'queued','Programación autorizada',?,?)")
      .run(randomUUID(), runId, JSON.stringify(target.targetIds), target.targetFingerprint, at, at);
  });
  return executeAgentSummaryStep(profileId, runId, "summary", db, now);
}
