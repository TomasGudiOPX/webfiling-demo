import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CollectionPeriodStatus, CollectionRuleDefinition, DemoProfileId } from "../types";
import { canManageCollectionRule, canReadCollectionPeriod } from "./agent-access.server";
import { isSystemAdministrator } from "./agent-access.server";
import { getConfig } from "./config";
import { openDatabase } from "./db.server";
import { transaction } from "./sqlite-transaction.server";
import { collectionRuleDefinition } from "./collection-rules.server";
import { previewCollectionWindows } from "./schedule-window.server";
import { previousCronOccurrences } from "./schedule-cron.server";

const MAX_BATCH = 100;
const HORIZON_MS = 90 * 24 * 60 * 60_000;

export class CollectionPeriodError extends Error {
  constructor(readonly code: "not_found" | "forbidden" | "invalid", readonly status: 400 | 403 | 404) {
    super(code === "not_found" ? "Período no disponible." : code === "forbidden" ? "Acción no permitida." : "El motivo de cancelación no es válido.");
  }
}

function insertEvent(db: DatabaseSync, periodId: string, eventType: string, actor: DemoProfileId | null, at: string, details: Record<string, unknown>) {
  db.prepare("INSERT INTO collection_events (id,period_id,event_type,actor_profile_id,occurred_at,details_json) VALUES (?,?,?,?,?,?)")
    .run(randomUUID(), periodId, eventType, actor, at, JSON.stringify(details));
}

function periodStatus(
  period: { opens_at: string; closes_at: string; status: string; cancelled_at: string | null; superseded_at: string | null },
  definition: CollectionRuleDefinition,
  evidence: Array<{ slot_key: string; is_late: number }>,
  now: Date,
): { status: CollectionPeriodStatus; missing: Array<{ slotKey: string; count: number }> } {
  if (period.cancelled_at || period.status === "cancelled") return { status: "cancelled", missing: [] };
  if (period.superseded_at) return { status: "superseded", missing: [] };
  const counts = new Map<string, number>();
  for (const item of evidence) counts.set(item.slot_key, (counts.get(item.slot_key) ?? 0) + 1);
  const missing = definition.slots.flatMap((slot) => {
    const count = Math.max(0, slot.requiredCount - (counts.get(slot.key) ?? 0));
    return count ? [{ slotKey: slot.key, count }] : [];
  });
  const complete = missing.length === 0;
  const late = evidence.some((item) => Boolean(item.is_late));
  const opens = new Date(period.opens_at).getTime();
  const closes = new Date(period.closes_at).getTime();
  if (now.getTime() < opens) return { status: "upcoming", missing };
  if (complete) return { status: late ? "received_late" : "received", missing };
  if (now.getTime() <= closes)
    return { status: evidence.length ? "partial" : "pending", missing };
  return { status: "overdue", missing };
}

function evidenceForPeriod(periodId: string, db: DatabaseSync) {
  return db.prepare(
    `SELECT e.slot_key,e.is_late FROM collection_evidence e
     JOIN library_file_metadata m ON m.file_id=e.file_id
     WHERE e.period_id=? AND e.active=1 AND m.trashed_at IS NULL`,
  ).all(periodId) as Array<{ slot_key: string; is_late: number }>;
}

export function materializeRulePeriods(ruleId: string, now = new Date(), db = openDatabase(), batch = MAX_BATCH): number {
  if (!getConfig().demoMode || !Number.isInteger(batch) || batch < 1 || batch > MAX_BATCH) return 0;
  const rule = db.prepare(
    "SELECT id,current_version,recipient_profile_id,collection_id,enabled,paused_at,archived_at,managing_profile_id,management_blocked FROM collection_rules WHERE id=?",
  ).get(ruleId) as {
    id: string; current_version: number; recipient_profile_id: DemoProfileId; collection_id: string;
    enabled: number; paused_at: string | null; archived_at: string | null; managing_profile_id: DemoProfileId | null; management_blocked: number;
  } | undefined;
  if (!rule || !rule.enabled || rule.paused_at || rule.archived_at || rule.management_blocked || !rule.managing_profile_id || !isSystemAdministrator(rule.managing_profile_id, db)) return 0;
  const definition = collectionRuleDefinition(ruleId, rule.current_version, db);
  const recurrence = definition.recurrence as Parameters<typeof previewCollectionWindows>[0];
  let windows = previewCollectionWindows(recurrence, now, recurrence.kind === "one_off" ? 1 : Math.min(batch, 10));
  if (recurrence.kind !== "one_off") {
    const expression = recurrence.kind === "cron" ? recurrence.expression
      : recurrence.kind === "weekly" ? `${recurrence.minute} ${recurrence.hour} * * ${recurrence.weekday}`
        : `${recurrence.minute} ${recurrence.hour} ${recurrence.day} * *`;
    const previous = previousCronOccurrences(expression, recurrence.timezone, new Date(now.getTime() + 1), 1)[0];
    if (previous && previous.getTime() >= now.getTime() - HORIZON_MS) {
      const lastWindow = previewCollectionWindows(recurrence, new Date(previous.getTime() - 1), 1)[0];
      const version = db.prepare("SELECT created_at FROM collection_rule_versions WHERE rule_id=? AND version=?")
        .get(ruleId, rule.current_version) as { created_at: string } | undefined;
      if (version && version.created_at <= lastWindow.opensAt) windows = [lastWindow, ...windows];
    }
  }
  const horizon = now.getTime() + HORIZON_MS;
  let inserted = 0;
  transaction(db, () => {
    for (const window of windows) {
      const opens = new Date(window.opensAt);
      if (recurrence.kind !== "one_off" && opens.getTime() > horizon) continue;
      const id = randomUUID();
      const timestamp = now.toISOString();
      const result = db.prepare(
        `INSERT INTO collection_periods
         (id,rule_id,rule_version,occurrence_key,recipient_profile_id,collection_id,opens_at,closes_at,timezone,status,evaluated_at,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,'upcoming',?,?) ON CONFLICT(rule_id,occurrence_key) DO NOTHING`,
      ).run(id, rule.id, rule.current_version, `${rule.current_version}:${window.opensAt}`, rule.recipient_profile_id, rule.collection_id,
        window.opensAt, window.closesAt, window.timezone, timestamp, timestamp);
      if (!result.changes) continue;
      inserted++;
      insertEvent(db, id, "period_created", null, timestamp, { ruleVersion: rule.current_version });
      evaluatePeriodInTransaction(id, now, db);
    }
  });
  return inserted;
}

function readPeriodRow(periodId: string, db: DatabaseSync) {
  const period = db.prepare("SELECT * FROM collection_periods WHERE id=?").get(periodId) as {
    id: string; rule_id: string; rule_version: number; recipient_profile_id: DemoProfileId;
    collection_id: string; opens_at: string; closes_at: string; timezone: string; status: string;
    evaluated_at: string | null; cancelled_at: string | null; cancellation_reason: string | null;
    superseded_at: string | null; created_at: string;
  } | undefined;
  if (!period) throw new CollectionPeriodError("not_found", 404);
  const definition = collectionRuleDefinition(period.rule_id, period.rule_version, db);
  return { period, definition };
}

export function evaluatePeriodInTransaction(periodId: string, now: Date, db: DatabaseSync) {
  const { period, definition } = readPeriodRow(periodId, db);
  const evidence = evidenceForPeriod(periodId, db);
  const derived = periodStatus(period, definition, evidence, now);
  const timestamp = now.toISOString();
  if (derived.status === "superseded") {
    db.prepare("UPDATE collection_periods SET evaluated_at=? WHERE id=?").run(timestamp, periodId);
  } else if (period.status !== derived.status) {
    db.prepare("UPDATE collection_periods SET status=?,evaluated_at=? WHERE id=?")
      .run(derived.status, timestamp, periodId);
    insertEvent(db, periodId, "status_changed", null, timestamp, { from: period.status, to: derived.status, missing: derived.missing });
  } else {
    db.prepare("UPDATE collection_periods SET evaluated_at=? WHERE id=?").run(timestamp, periodId);
  }
  return { ...periodDto(period, definition, derived, evidence), evaluatedAt: timestamp };
}

function periodDto(
  period: { id: string; rule_id: string; rule_version: number; recipient_profile_id: DemoProfileId; collection_id: string; opens_at: string; closes_at: string; timezone: string; status: string; evaluated_at?: string | null; cancelled_at: string | null; cancellation_reason: string | null; superseded_at: string | null; created_at: string },
  definition: CollectionRuleDefinition,
  derived: ReturnType<typeof periodStatus>,
  evidence: Array<{ slot_key: string; is_late: number }>,
) {
  return {
    id: period.id, ruleId: period.rule_id, ruleVersion: period.rule_version,
    recipientProfileId: period.recipient_profile_id, collectionId: period.collection_id,
    opensAt: period.opens_at, closesAt: period.closes_at, timezone: period.timezone,
    status: derived.status, missing: derived.missing,
    slots: definition.slots.map((slot) => ({ key: slot.key, label: slot.label, requiredCount: slot.requiredCount,
      receivedCount: evidence.filter((item) => item.slot_key === slot.key).length })),
    cancelledAt: period.cancelled_at, cancellationReason: period.cancellation_reason,
    superseded: Boolean(period.superseded_at), evaluatedAt: period.evaluated_at ?? null,
    createdAt: period.created_at,
  };
}

export function evaluateCollectionPeriod(periodId: string, now = new Date(), db = openDatabase()) {
  if (!getConfig().demoMode) throw new CollectionPeriodError("not_found", 404);
  return transaction(db, () => evaluatePeriodInTransaction(periodId, now, db));
}

export function reconcileCollectionPeriods(now = new Date(), db = openDatabase(), limit = MAX_BATCH, collectionId?: string): number {
  if (!getConfig().demoMode || !Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH) return 0;
  const ids = db.prepare(
    `SELECT id FROM collection_periods WHERE status NOT IN ('cancelled') AND superseded_at IS NULL
     ${collectionId ? "AND collection_id=?" : ""} ORDER BY closes_at LIMIT ?`,
  ).all(...(collectionId ? [collectionId, limit] : [limit])) as Array<{ id: string }>;
  for (const { id } of ids) evaluateCollectionPeriod(id, now, db);
  return ids.length;
}

export function cancelCollectionPeriod(profileId: DemoProfileId, periodId: string, reason: string, db = openDatabase(), now = new Date()) {
  if (!getConfig().demoMode) throw new CollectionPeriodError("not_found", 404);
  const { period, definition } = readPeriodRow(periodId, db);
  if (!canManageCollectionRule(profileId, period.rule_id, db)) throw new CollectionPeriodError("not_found", 404);
  if (typeof reason !== "string" || reason.trim().length < 3 || reason.trim().length > 500)
    throw new CollectionPeriodError("invalid", 400);
  if (period.cancelled_at || period.superseded_at) throw new CollectionPeriodError("invalid", 400);
  return transaction(db, () => {
    const timestamp = now.toISOString();
    db.prepare("UPDATE collection_periods SET status='cancelled',cancelled_at=?,cancellation_reason=?,evaluated_at=? WHERE id=?")
      .run(timestamp, reason.trim(), timestamp, periodId);
    insertEvent(db, periodId, "cancelled", profileId, timestamp, { reason: reason.trim() });
    const fresh = db.prepare("SELECT * FROM collection_periods WHERE id=?").get(periodId) as typeof period;
    return periodDto(fresh, definition, { status: "cancelled", missing: [] }, evidenceForPeriod(periodId, db));
  });
}

export function listCollectionPeriods(profileId: DemoProfileId, collectionId: string, db = openDatabase(), now = new Date()) {
  if (!getConfig().demoMode) throw new CollectionPeriodError("not_found", 404);
  const rows = db.prepare("SELECT * FROM collection_periods WHERE collection_id=? ORDER BY opens_at DESC")
    .all(collectionId) as Array<Parameters<typeof periodDto>[0]>;
  return rows.flatMap((period) => {
    if (!canReadCollectionPeriod(profileId, period.id, db)) return [];
    const definition = collectionRuleDefinition(period.rule_id, period.rule_version, db);
    const evidence = evidenceForPeriod(period.id, db);
    const derived = periodStatus(period, definition, evidence, now);
    return [periodDto(period, definition, derived, evidence)];
  });
}
