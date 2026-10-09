import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DemoProfileId, ScheduledAction } from "../types";
import { getConfig } from "./config";
import { openDatabase } from "./db.server";
import { nextCronOccurrences, previousCronOccurrences } from "./schedule-cron.server";
import { transaction } from "./sqlite-transaction.server";
import { canManageAgentSchedule, canManageCollectionRule } from "./agent-access.server";
import { collectionCapabilities } from "./file-access.server";
import { evaluateCollectionPeriod, materializeRulePeriods, reconcileCollectionPeriods } from "./collection-periods.server";
import { executeScheduledCollectionSummary } from "./agent-plans.server";

export interface ClaimedScheduledRun {
  id: string;
  scheduleId: string;
  occurrenceKey: string;
  actionType: ScheduledAction | "period_generation";
  attempt: number;
  effectKey: string;
  leaseExpiresAt: string;
}

export function writeAgentWorkerHeartbeat(workerId: string, status: "running" | "stopped" | "error", db = openDatabase(), now = new Date(), errorCode: string | null = null, lastSuccessAt: string | null = null) {
  requireWorker(workerId, 5_000);
  db.prepare(
    `INSERT INTO worker_heartbeats (worker_id,started_at,heartbeat_at,last_success_at,status,safe_error_code)
     VALUES (?,?,?,?,?,?) ON CONFLICT(worker_id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at,
     last_success_at=COALESCE(excluded.last_success_at,worker_heartbeats.last_success_at),status=excluded.status,safe_error_code=excluded.safe_error_code`,
  ).run(workerId, now.toISOString(), now.toISOString(), lastSuccessAt, status, errorCode);
}

export function readAgentWorkerStatus(db = openDatabase(), now = new Date()) {
  if (!getConfig().demoMode) return { status: "unavailable" as const, stale: true, heartbeatAt: null, lastSuccessAt: null };
  const row = db.prepare("SELECT status,heartbeat_at,last_success_at FROM worker_heartbeats ORDER BY heartbeat_at DESC LIMIT 1").get() as { status: string; heartbeat_at: string; last_success_at: string | null } | undefined;
  if (!row) return { status: "unavailable" as const, stale: true, heartbeatAt: null, lastSuccessAt: null };
  const stale = now.getTime() - new Date(row.heartbeat_at).getTime() > 45_000;
  return { status: stale && row.status === "running" ? "stale" as const : row.status, stale, heartbeatAt: row.heartbeat_at, lastSuccessAt: row.last_success_at };
}

export function listAgentNotices(profileId: DemoProfileId, db = openDatabase(), limit = 100) {
  if (!getConfig().demoMode || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) return [];
  return db.prepare(
    `SELECT n.id,n.period_id,n.notice_kind,n.missing_json,n.created_at,n.updated_at,p.collection_id,c.name AS collection_name,p.closes_at
     FROM agent_notices n JOIN collection_periods p ON p.id=n.period_id JOIN collections c ON c.id=p.collection_id
     JOIN collection_grants g ON g.profile_id=n.recipient_profile_id AND g.collection_id=p.collection_id AND g.can_contribute=1
     WHERE n.recipient_profile_id=? AND n.dismissed_at IS NULL AND p.cancelled_at IS NULL AND p.superseded_at IS NULL
     ORDER BY n.created_at DESC,n.id DESC LIMIT ?`,
  ).all(profileId, limit) as Array<Record<string, unknown>>;
}

function requireWorker(workerId: string, leaseMs: number) {
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(workerId) || !Number.isSafeInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 10 * 60_000)
    throw new Error("Invalid worker lease.");
}

export function materializeDueScheduledRuns(db = openDatabase(), now = new Date(), limit = 50): number {
  if (!getConfig().demoMode || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) return 0;
  return transaction(db, () => {
    const due = db.prepare(
      `SELECT id,schedule_kind,action_type,timezone,cron_expression,run_at,next_run_at
       FROM agent_schedules WHERE archived_at IS NULL AND paused_at IS NULL AND next_run_at IS NOT NULL AND next_run_at<=?
       ORDER BY next_run_at,id LIMIT ?`,
    ).all(now.toISOString(), limit) as Array<{
      id: string; schedule_kind: "once" | "recurring"; action_type: ScheduledAction;
      timezone: string; cron_expression: string; run_at: string | null; next_run_at: string;
    }>;
    for (const schedule of due) {
      let occurrenceAt = schedule.next_run_at;
      let coalesced = false;
      if (schedule.schedule_kind === "recurring" && now.getTime() - new Date(schedule.next_run_at).getTime() > 90 * 24 * 60 * 60_000) {
        const latest = previousCronOccurrences(schedule.cron_expression, schedule.timezone, new Date(now.getTime() + 1), 1)[0];
        if (latest) { occurrenceAt = latest.toISOString(); coalesced = true; }
      }
      const occurrenceKey = schedule.schedule_kind === "once" ? `once:${schedule.run_at}`
        : coalesced ? `cron:coalesced:${schedule.next_run_at}:${occurrenceAt}` : `cron:${occurrenceAt}`;
      const effectKey = createHash("sha256").update(`${schedule.id}\0${occurrenceKey}\0${schedule.action_type}`).digest("hex");
      const runId = `scheduled-${effectKey}`;
      db.prepare(
        `INSERT OR IGNORE INTO scheduled_runs
         (id,schedule_id,occurrence_key,action_type,status,trigger_kind,available_at,created_at)
         VALUES (?,?,?,?, 'queued','scheduled',?,?)`,
      ).run(runId, schedule.id, occurrenceKey, schedule.action_type, now.toISOString(), now.toISOString());
      let nextRunAt: string | null = null;
      if (schedule.schedule_kind === "recurring") {
        nextRunAt = nextCronOccurrences(schedule.cron_expression, schedule.timezone, new Date(occurrenceAt), 1)[0]?.toISOString() ?? null;
      }
      db.prepare("UPDATE agent_schedules SET next_run_at=?,updated_at=? WHERE id=? AND next_run_at=? AND paused_at IS NULL AND archived_at IS NULL")
        .run(nextRunAt, now.toISOString(), schedule.id, schedule.next_run_at);
    }
    return due.length;
  });
}

export function claimDueScheduledRun(workerId: string, db = openDatabase(), now = new Date(), leaseMs = 60_000): ClaimedScheduledRun | null {
  requireWorker(workerId, leaseMs);
  if (!getConfig().demoMode) return null;
  return transaction(db, () => {
    const row = db.prepare(
      `SELECT r.id,r.schedule_id,r.occurrence_key,r.action_type,r.attempt_count
       FROM scheduled_runs r JOIN agent_schedules s ON s.id=r.schedule_id
       WHERE r.available_at<=? AND s.paused_at IS NULL AND s.archived_at IS NULL
         AND (r.status='queued' OR (r.status='running' AND r.lease_expires_at<=?))
       ORDER BY r.available_at,r.created_at,r.id LIMIT 1`,
    ).get(now.toISOString(), now.toISOString()) as {
      id: string; schedule_id: string; occurrence_key: string; action_type: ScheduledAction | "period_generation"; attempt_count: number;
    } | undefined;
    if (!row) return null;
    const attempt = row.attempt_count + 1;
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const claimed = db.prepare(
      `UPDATE scheduled_runs SET status='running',lease_owner=?,lease_expires_at=?,attempt_count=?,started_at=COALESCE(started_at,?)
       WHERE id=? AND (status='queued' OR (status='running' AND lease_expires_at<=?))`,
    ).run(workerId, leaseExpiresAt, attempt, now.toISOString(), row.id, now.toISOString());
    if (!claimed.changes) return null;
    return {
      id: row.id, scheduleId: row.schedule_id, occurrenceKey: row.occurrence_key,
      actionType: row.action_type, attempt,
      effectKey: createHash("sha256").update(`${row.schedule_id}\0${row.occurrence_key}\0${row.action_type}`).digest("hex"),
      leaseExpiresAt,
    };
  });
}

export function renewScheduledRunLease(workerId: string, runId: string, attempt: number, db = openDatabase(), now = new Date(), leaseMs = 60_000): boolean {
  requireWorker(workerId, leaseMs);
  return transaction(db, () => Boolean(db.prepare(
    `UPDATE scheduled_runs SET lease_expires_at=? WHERE id=? AND status='running' AND lease_owner=? AND attempt_count=? AND lease_expires_at>?
     AND EXISTS (SELECT 1 FROM agent_schedules s WHERE s.id=scheduled_runs.schedule_id AND s.paused_at IS NULL AND s.archived_at IS NULL)`,
  ).run(new Date(now.getTime() + leaseMs).toISOString(), runId, workerId, attempt, now.toISOString()).changes));
}

export function completeScheduledRun(workerId: string, runId: string, attempt: number, result: unknown, db = openDatabase(), now = new Date()): boolean {
  const resultJson = JSON.stringify(result);
  if (resultJson.length > 64 * 1024) throw new Error("Scheduled result exceeds its storage bound.");
  return transaction(db, () => Boolean(db.prepare(
    `UPDATE scheduled_runs SET status='succeeded',result_json=?,finished_at=?,lease_owner=NULL,lease_expires_at=NULL
     WHERE id=? AND status='running' AND lease_owner=? AND attempt_count=? AND lease_expires_at>?
     AND EXISTS (SELECT 1 FROM agent_schedules s WHERE s.id=scheduled_runs.schedule_id AND s.paused_at IS NULL AND s.archived_at IS NULL)`,
  ).run(resultJson, now.toISOString(), runId, workerId, attempt, now.toISOString()).changes));
}

export function reconcileAgentNotices(now = new Date(), db = openDatabase(), limit = 100, collectionId?: string): number {
  if (!getConfig().demoMode || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) return 0;
  const periods = db.prepare(
    `SELECT id,recipient_profile_id,collection_id,closes_at,cancelled_at,superseded_at
     FROM collection_periods ${collectionId ? "WHERE collection_id=?" : ""} ORDER BY closes_at LIMIT ?`,
  ).all(...(collectionId ? [collectionId, limit] : [limit])) as Array<{
    id: string; recipient_profile_id: string; collection_id: string; closes_at: string; cancelled_at: string | null; superseded_at: string | null;
  }>;
  let writes = 0;
  for (const period of periods) {
    const grant = db.prepare("SELECT can_contribute FROM collection_grants WHERE profile_id=? AND collection_id=?").get(period.recipient_profile_id, period.collection_id) as { can_contribute: number } | undefined;
    if (!grant?.can_contribute || period.cancelled_at || period.superseded_at) {
      writes += Number(db.prepare("UPDATE agent_notices SET dismissed_at=COALESCE(dismissed_at,?),updated_at=? WHERE period_id=? AND dismissed_at IS NULL").run(now.toISOString(), now.toISOString(), period.id).changes);
      continue;
    }
    const current = evaluateCollectionPeriod(period.id, now, db);
    const hoursUntilClose = (new Date(period.closes_at).getTime() - now.getTime()) / 3_600_000;
    const kind = current.status === "overdue" ? "overdue" :
      ["pending", "partial"].includes(current.status) && hoursUntilClose >= 0 && hoursUntilClose <= 24 ? "due_soon" : null;
    const expiredKind = kind === "overdue" ? "due_soon" : kind === "due_soon" ? "overdue" : null;
    if (expiredKind) writes += Number(db.prepare("UPDATE agent_notices SET dismissed_at=COALESCE(dismissed_at,?),updated_at=? WHERE period_id=? AND notice_kind=? AND dismissed_at IS NULL").run(now.toISOString(), now.toISOString(), period.id, expiredKind).changes);
    if (!kind) {
      writes += Number(db.prepare("UPDATE agent_notices SET dismissed_at=COALESCE(dismissed_at,?),updated_at=? WHERE period_id=? AND dismissed_at IS NULL").run(now.toISOString(), now.toISOString(), period.id).changes);
      continue;
    }
    const missing = JSON.stringify({ items: current.missing, closesAt: period.closes_at, status: current.status });
    const result = db.prepare(
      `INSERT INTO agent_notices (id,period_id,recipient_profile_id,notice_kind,missing_json,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?) ON CONFLICT(period_id,recipient_profile_id,notice_kind) DO UPDATE SET missing_json=excluded.missing_json,updated_at=excluded.updated_at
       WHERE agent_notices.dismissed_at IS NULL AND agent_notices.missing_json!=excluded.missing_json`,
    ).run(createHash("sha256").update(`${period.id}\0${period.recipient_profile_id}\0${kind}`).digest("hex"), period.id, period.recipient_profile_id, kind, missing, now.toISOString(), now.toISOString());
    writes += Number(result.changes);
  }
  return writes;
}

export async function executeClaimedScheduledRun(workerId: string, claim: ClaimedScheduledRun, db = openDatabase(), now = new Date()) {
  const schedule = db.prepare(
    "SELECT owner_profile_id,managing_profile_id,management_blocked,collection_id,action_type,paused_at,archived_at FROM agent_schedules WHERE id=?",
  ).get(claim.scheduleId) as { owner_profile_id: string; managing_profile_id: string | null; management_blocked: number; collection_id: string; action_type: string; paused_at: string | null; archived_at: string | null } | undefined;
  const fencedUpdate = (status: "blocked" | "failed" | "queued", code: string, availableAt: string | null) => transaction(db, () => Boolean(db.prepare(
    `UPDATE scheduled_runs SET status=?,safe_error_code=?,available_at=COALESCE(?,available_at),finished_at=?,lease_owner=NULL,lease_expires_at=NULL
     WHERE id=? AND status='running' AND lease_owner=? AND attempt_count=? AND lease_expires_at>?`,
  ).run(status, code, availableAt, status === "queued" ? null : now.toISOString(), claim.id, workerId, claim.attempt, now.toISOString()).changes));
  const managingProfileId = schedule?.managing_profile_id as DemoProfileId | null | undefined;
  if (!getConfig().demoMode || !schedule || schedule.management_blocked || schedule.paused_at || schedule.archived_at || managingProfileId !== "system-administrator" || !canManageAgentSchedule(managingProfileId, claim.scheduleId, db) || !collectionCapabilities(managingProfileId, schedule.collection_id, db).canRead) {
    fencedUpdate("blocked", "permission_changed", null);
    return { status: "blocked" as const, errorCode: "permission_changed" };
  }
  try {
    let result: unknown;
    if (schedule.action_type === "collection_check") {
      const rules = db.prepare(
        `SELECT r.id,r.recipient_profile_id FROM collection_rules r
         JOIN collection_grants g ON g.profile_id=r.recipient_profile_id AND g.collection_id=r.collection_id AND g.can_contribute=1
         WHERE r.collection_id=? AND r.enabled=1 AND r.paused_at IS NULL AND r.archived_at IS NULL AND r.management_blocked=0 AND r.managing_profile_id='system-administrator' ORDER BY r.id LIMIT 50`,
      ).all(schedule.collection_id) as Array<{ id: string; recipient_profile_id: string }>;
      let generated = 0;
      for (const rule of rules) {
        if (!canManageCollectionRule(managingProfileId, rule.id, db)) continue;
        generated += materializeRulePeriods(rule.id, now, db, 10);
      }
      const reconciled = reconcileCollectionPeriods(now, db, 100, schedule.collection_id);
      const notices = reconcileAgentNotices(now, db, 100, schedule.collection_id);
      result = { generatedPeriods: generated, reconciledPeriods: reconciled, noticeChanges: notices };
    } else if (schedule.action_type === "collection_summary") {
      const summary = await executeScheduledCollectionSummary(managingProfileId, schedule.collection_id, claim.effectKey, db, now);
      result = { runStatus: summary.status, coverage: summary.coverage };
    } else {
      fencedUpdate("blocked", "unsupported_operation", null);
      return { status: "blocked" as const, errorCode: "unsupported_operation" };
    }
    const completed = completeScheduledRun(workerId, claim.id, claim.attempt, result, db, now);
    return completed ? { status: "succeeded" as const, result } : { status: "lease_lost" as const };
  } catch {
    const delayMs = claim.attempt === 1 ? 30_000 : 120_000;
    const retryable = claim.attempt < 3;
    const updated = fencedUpdate(retryable ? "queued" : "failed", retryable ? "transient_failure" : "retry_exhausted", retryable ? new Date(now.getTime() + delayMs).toISOString() : null);
    return { status: updated ? retryable ? "retry_scheduled" as const : "failed" as const : "lease_lost" as const,
      errorCode: retryable ? "transient_failure" : "retry_exhausted" };
  }
}
