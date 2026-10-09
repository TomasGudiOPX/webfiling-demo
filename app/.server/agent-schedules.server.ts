import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DemoProfileId, ScheduledAction } from "../types";
import { canManageAgentSchedule, canManageCollectionRule, isSystemAdministrator } from "./agent-access.server";
import { getConfig } from "./config";
import { collectionCapabilities } from "./file-access.server";
import { openDatabase } from "./db.server";
import { ScheduleInputError, nextCronOccurrences, validateCronSchedule } from "./schedule-cron.server";
import { transaction } from "./sqlite-transaction.server";

export class ScheduleServiceError extends Error {
  constructor(readonly code: string, readonly status: 400 | 403 | 404 | 409) {
    super(
      code === "not_found" ? "Programación no disponible."
        : code === "forbidden" ? "Acción no permitida."
          : code === "conflict" ? "La programación cambió. Actualiza e inténtalo de nuevo."
            : code === "too_frequent" ? "La frecuencia mínima permitida es cada 15 minutos."
              : code === "invalid_timezone" ? "Selecciona una zona horaria IANA válida."
                : "La programación no es válida.",
    );
  }
}

type Input = Record<string, unknown>;
type ScheduleConfig = {
  scheduleKind: "once" | "recurring";
  actionType: ScheduledAction;
  collectionId: string;
  timezone: string;
  cronExpression: string;
  runAt: string | null;
};
export interface AgentScheduleDTO {
  id: string;
  ownerProfileId: DemoProfileId;
  managingProfileId: DemoProfileId | null;
  managementBlocked: boolean;
  collectionId: string;
  ruleId: string | null;
  actionType: ScheduledAction;
  scheduleKind: "once" | "recurring";
  timezone: string;
  cronExpression: string | null;
  runAt: string | null;
  nextRunAt: string | null;
  pausedAt: string | null;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface ManualScheduleRunDTO {
  id: string;
  status: string;
  nextRunAt: string | null;
}
const actions = new Set<ScheduledAction>(["collection_check", "collection_summary"]);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const defaultTimezone = "America/Argentina/Buenos_Aires";

function inputObject(value: unknown, keys: readonly string[]): Input {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ScheduleServiceError("invalid", 400);
  const object = value as Input;
  if (Object.keys(object).some((key) => !keys.includes(key)))
    throw new ScheduleServiceError("invalid", 400);
  return object;
}
function requiredId(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) throw new ScheduleServiceError("invalid", 400);
  return value;
}
function requiredVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new ScheduleServiceError("invalid", 400);
  return Number(value);
}
function configFrom(input: Input, now: Date): ScheduleConfig {
  const actionType = input.actionType;
  const collectionId = requiredId(input.collectionId);
  const scheduleKind = input.scheduleKind;
  const timezone = input.timezone === undefined ? defaultTimezone : input.timezone;
  if (typeof timezone !== "string" || timezone.length > 80)
    throw new ScheduleServiceError("invalid", 400);
  if (actionType !== undefined && (typeof actionType !== "string" || !actions.has(actionType as ScheduledAction)))
    throw new ScheduleServiceError("invalid", 400);
  if (scheduleKind !== "once" && scheduleKind !== "recurring")
    throw new ScheduleServiceError("invalid", 400);
  if (scheduleKind === "once") {
    if (typeof input.runAt !== "string") throw new ScheduleServiceError("invalid", 400);
    const runAt = new Date(input.runAt);
    if (!Number.isFinite(runAt.getTime()) || runAt.getTime() <= now.getTime())
      throw new ScheduleServiceError("invalid", 400);
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(runAt); }
    catch { throw new ScheduleServiceError("invalid", 400); }
    return { scheduleKind, actionType: actionType as ScheduledAction, collectionId, timezone, cronExpression: "", runAt: runAt.toISOString() };
  }
  const cronExpression = input.cronExpression;
  if (typeof cronExpression !== "string") throw new ScheduleServiceError("invalid", 400);
  try { validateCronSchedule(cronExpression, timezone, now); }
  catch (error) { if (error instanceof ScheduleInputError) throw new ScheduleServiceError(error.code, 400); throw error; }
  return { scheduleKind, actionType: actionType as ScheduledAction, collectionId, timezone, cronExpression, runAt: null };
}

function canUseCollection(profileId: DemoProfileId, collectionId: string, db: DatabaseSync) {
  const capabilities = collectionCapabilities(profileId, collectionId, db);
  if (!capabilities.canRead) throw new ScheduleServiceError("not_found", 404);
  if (!capabilities.canContribute && !capabilities.canOrganize)
    throw new ScheduleServiceError("forbidden", 403);
}

function dto(row: Record<string, unknown>): AgentScheduleDTO {
  return {
    id: String(row.id),
    ownerProfileId: row.owner_profile_id as DemoProfileId,
    managingProfileId: row.managing_profile_id == null ? null : row.managing_profile_id as DemoProfileId,
    managementBlocked: Boolean(row.management_blocked),
    collectionId: String(row.collection_id),
    ruleId: row.rule_id === null ? null : String(row.rule_id),
    actionType: row.action_type as ScheduledAction,
    scheduleKind: row.schedule_kind as "once" | "recurring",
    timezone: String(row.timezone),
    cronExpression: row.schedule_kind === "recurring" ? String(row.cron_expression) : null,
    runAt: row.run_at === null ? null : String(row.run_at),
    nextRunAt: row.next_run_at === null ? null : String(row.next_run_at),
    pausedAt: row.paused_at === null ? null : String(row.paused_at),
    archivedAt: row.archived_at === null ? null : String(row.archived_at),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
const selectColumns = `id,owner_profile_id,managing_profile_id,management_blocked,collection_id,rule_id,action_type,schedule_kind,timezone,cron_expression,run_at,next_run_at,paused_at,archived_at,version,created_at,updated_at`;

function findSchedule(profileId: DemoProfileId, scheduleId: string, db: DatabaseSync) {
  const row = db.prepare(`SELECT ${selectColumns} FROM agent_schedules WHERE id=? AND archived_at IS NULL`).get(scheduleId) as Record<string, unknown> | undefined;
  if (!row || !canManageAgentSchedule(profileId, scheduleId, db))
    throw new ScheduleServiceError("not_found", 404);
  return row;
}

function nextRun(config: ScheduleConfig, now: Date): string {
  if (config.scheduleKind === "once") return config.runAt!;
  try {
    const next = nextCronOccurrences(config.cronExpression, config.timezone, now, 1)[0];
    if (!next) throw new ScheduleServiceError("invalid", 400);
    return next.toISOString();
  } catch (error) {
    if (error instanceof ScheduleServiceError) throw error;
    if (error instanceof ScheduleInputError) throw new ScheduleServiceError(error.code, 400);
    throw error;
  }
}

export function listAgentSchedules(profileId: DemoProfileId, db = openDatabase()) {
  if (!getConfig().demoMode) throw new ScheduleServiceError("not_found", 404);
  const rows = db.prepare(
    `SELECT s.${selectColumns.replaceAll(",", ",s.")} FROM agent_schedules s
     JOIN collection_grants g ON g.collection_id=s.collection_id AND g.profile_id=? AND g.can_read=1
     WHERE s.archived_at IS NULL ORDER BY s.next_run_at,s.created_at`,
  ).all(profileId) as Array<Record<string, unknown>>;
  return rows.filter((row) => canManageAgentSchedule(profileId, String(row.id), db) || (isSystemAdministrator(profileId, db) && Boolean(row.management_blocked))).map(dto);
}

export function createAgentSchedule(profileId: DemoProfileId, value: unknown, db = openDatabase(), now = new Date()) {
  if (!getConfig().demoMode) throw new ScheduleServiceError("not_found", 404);
  if (!isSystemAdministrator(profileId, db)) throw new ScheduleServiceError("forbidden", 403);
  const input = inputObject(value, ["actionType", "collectionId", "scheduleKind", "timezone", "cronExpression", "runAt"]);
  if (typeof input.actionType !== "string" || !actions.has(input.actionType as ScheduledAction))
    throw new ScheduleServiceError("invalid", 400);
  const config = configFrom(input, now);
  return transaction(db, () => {
    canUseCollection(profileId, config.collectionId, db);
    const count = (db.prepare("SELECT count(*) AS count FROM agent_schedules WHERE owner_profile_id=? AND archived_at IS NULL").get(profileId) as { count: number }).count;
    if (count >= 20) throw new ScheduleServiceError("conflict", 409);
    const id = randomUUID();
    const timestamp = now.toISOString();
    db.prepare(
      `INSERT INTO agent_schedules
       (id,owner_profile_id,managing_profile_id,management_blocked,collection_id,action_type,schedule_kind,timezone,cron_expression,run_at,next_run_at,version,created_at,updated_at)
       VALUES (?,?,?,0,?,?,?,?,?,?,?,1,?,?)`,
    ).run(id, profileId, profileId, config.collectionId, config.actionType, config.scheduleKind, config.timezone, config.cronExpression, config.runAt, nextRun(config, now), timestamp, timestamp);
    return dto(db.prepare(`SELECT ${selectColumns} FROM agent_schedules WHERE id=?`).get(id) as Record<string, unknown>);
  });
}

export function updateAgentSchedule(profileId: DemoProfileId, scheduleId: string, value: unknown, db = openDatabase(), now = new Date()) {
  if (!getConfig().demoMode) throw new ScheduleServiceError("not_found", 404);
  if (!isSystemAdministrator(profileId, db)) throw new ScheduleServiceError("forbidden", 403);
  const input = inputObject(value, ["version", "actionType", "collectionId", "scheduleKind", "timezone", "cronExpression", "runAt"]);
  const current = findSchedule(profileId, scheduleId, db);
  const version = requiredVersion(input.version);
  if (version !== current.version)
    throw new ScheduleServiceError("conflict", 409);
  const config = configFrom(input, now);
  canUseCollection(profileId, config.collectionId, db);
  const updatedAt = now.toISOString();
  const result = db.prepare(
    `UPDATE agent_schedules SET collection_id=?,action_type=?,schedule_kind=?,timezone=?,cron_expression=?,run_at=?,next_run_at=?,version=version+1,updated_at=?
     WHERE id=? AND version=? AND archived_at IS NULL`,
  ).run(config.collectionId, config.actionType, config.scheduleKind, config.timezone, config.cronExpression, config.runAt, nextRun(config, now), updatedAt, scheduleId, version);
  if (!result.changes) throw new ScheduleServiceError("conflict", 409);
  return dto(db.prepare(`SELECT ${selectColumns} FROM agent_schedules WHERE id=?`).get(scheduleId) as Record<string, unknown>);
}

export function archiveAgentSchedule(profileId: DemoProfileId, scheduleId: string, version: unknown, db = openDatabase(), now = new Date()) {
  if (!getConfig().demoMode) throw new ScheduleServiceError("not_found", 404);
  if (!isSystemAdministrator(profileId, db)) throw new ScheduleServiceError("forbidden", 403);
  findSchedule(profileId, scheduleId, db);
  const expectedVersion = requiredVersion(version);
  const result = db.prepare(
    "UPDATE agent_schedules SET archived_at=?,paused_at=COALESCE(paused_at,?),next_run_at=NULL,version=version+1,updated_at=? WHERE id=? AND version=? AND archived_at IS NULL",
  ).run(now.toISOString(), now.toISOString(), now.toISOString(), scheduleId, expectedVersion);
  if (!result.changes) throw new ScheduleServiceError("conflict", 409);
  return { id: scheduleId, archived: true };
}

export function controlAgentSchedule(profileId: DemoProfileId, scheduleId: string, value: unknown, db = openDatabase(), now = new Date()) {
  if (!getConfig().demoMode) throw new ScheduleServiceError("not_found", 404);
  if (!isSystemAdministrator(profileId, db)) throw new ScheduleServiceError("forbidden", 403);
  const input = inputObject(value, ["intent", "version", "requestId"]);
  if (input.intent === "adopt") {
    const current = db.prepare("SELECT * FROM agent_schedules WHERE id=? AND archived_at IS NULL").get(scheduleId) as Record<string, unknown> | undefined;
    if (!current || !Number(current.management_blocked)) throw new ScheduleServiceError("conflict", 409);
    const version = requiredVersion(input.version);
    if (version !== Number(current.version)) throw new ScheduleServiceError("conflict", 409);
    canUseCollection(profileId, String(current.collection_id), db);
    if (current.rule_id && !canManageCollectionRule(profileId, String(current.rule_id), db)) throw new ScheduleServiceError("conflict", 409);
    return transaction(db, () => {
      const nextVersion = version + 1;
      const timestamp = now.toISOString();
      const result = db.prepare("UPDATE agent_schedules SET managing_profile_id=?,management_blocked=0,version=?,updated_at=? WHERE id=? AND management_blocked=1 AND version=? AND archived_at IS NULL")
        .run(profileId, nextVersion, timestamp, scheduleId, version);
      if (!result.changes) throw new ScheduleServiceError("conflict", 409);
      db.prepare("INSERT INTO agent_schedule_events (id,schedule_id,actor_profile_id,event_type,version,occurred_at,details_json) VALUES (?,?,?,'adopted',?,?,?)")
        .run(randomUUID(), scheduleId, profileId, nextVersion, timestamp, JSON.stringify({ priorOwnerProfileId: current.owner_profile_id, remainsPaused: Boolean(current.paused_at) }));
      return dto(db.prepare(`SELECT ${selectColumns} FROM agent_schedules WHERE id=?`).get(scheduleId) as Record<string, unknown>);
    });
  }
  const current = findSchedule(profileId, scheduleId, db);
  const version = requiredVersion(input.version);
  if (version !== current.version)
    throw new ScheduleServiceError("conflict", 409);
  const timestamp = now.toISOString();
  if (input.intent === "pause" || input.intent === "resume") {
    const pausedAt = input.intent === "pause" ? timestamp : null;
    let next = current.next_run_at as string | null;
    if (input.intent === "resume") {
      const config = {
        scheduleKind: current.schedule_kind as "once" | "recurring",
        actionType: current.action_type as ScheduledAction,
        collectionId: current.collection_id as string,
        timezone: current.timezone as string,
        cronExpression: current.cron_expression as string,
        runAt: current.run_at as string | null,
      };
      next = config.scheduleKind === "once" && config.runAt && new Date(config.runAt) > now
        ? config.runAt
        : config.scheduleKind === "recurring" ? nextRun(config, now) : null;
      if (!next) throw new ScheduleServiceError("conflict", 409);
    }
    return transaction(db, () => {
      const result = db.prepare(
        "UPDATE agent_schedules SET paused_at=?,next_run_at=?,version=version+1,updated_at=? WHERE id=? AND version=? AND archived_at IS NULL",
      ).run(pausedAt, next, timestamp, scheduleId, version);
      if (!result.changes) throw new ScheduleServiceError("conflict", 409);
      if (input.intent === "pause") db.prepare(
        `UPDATE scheduled_runs SET status='skipped',safe_error_code='schedule_paused',finished_at=?,lease_owner=NULL,lease_expires_at=NULL
         WHERE schedule_id=? AND status IN ('queued','running')`,
      ).run(timestamp, scheduleId);
      return dto(db.prepare(`SELECT ${selectColumns} FROM agent_schedules WHERE id=?`).get(scheduleId) as Record<string, unknown>);
    });
  }
  if (input.intent === "run_now") {
    if (typeof input.requestId !== "string" || !idPattern.test(input.requestId))
      throw new ScheduleServiceError("invalid", 400);
    const requestId = input.requestId as string;
    const runId = randomUUID();
    db.prepare(
      `INSERT INTO scheduled_runs
       (id,schedule_id,occurrence_key,action_type,status,trigger_kind,available_at,created_at)
       VALUES (?,?,?,?,'queued','manual',?,?) ON CONFLICT(schedule_id,occurrence_key) DO NOTHING`,
    ).run(runId, scheduleId, `manual:${requestId}`, String(current.action_type), timestamp, timestamp);
    const run = db.prepare("SELECT id,status FROM scheduled_runs WHERE schedule_id=? AND occurrence_key=?").get(scheduleId, `manual:${requestId}`) as { id: string; status: string };
    return { id: run.id, status: run.status, nextRunAt: current.next_run_at };
  }
  throw new ScheduleServiceError("invalid", 400);
}

export function getAgentSchedule(profileId: DemoProfileId, scheduleId: string, db = openDatabase()) {
  if (!getConfig().demoMode) throw new ScheduleServiceError("not_found", 404);
  return dto(findSchedule(profileId, scheduleId, db));
}

export function mayManageBoundRule(profileId: DemoProfileId, ruleId: string, db = openDatabase()) {
  return canManageCollectionRule(profileId, ruleId, db);
}
