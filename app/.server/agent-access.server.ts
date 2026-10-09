import type { DatabaseSync } from "node:sqlite";
import type { DemoProfileId } from "../types";
import { getConfig } from "./config";
import { openDatabase } from "./db.server";

/** Callers must pass the profile resolved from the signed request context. */
export function canReadAgentRun(
  profileId: DemoProfileId,
  runId: string,
  db: DatabaseSync = openDatabase(),
): boolean {
  if (!getConfig().demoMode) return false;
  return Boolean(
    db.prepare("SELECT 1 FROM agent_runs WHERE id=? AND profile_id=?").get(runId, profileId),
  );
}

export function isSystemAdministrator(profileId: DemoProfileId, db: DatabaseSync = openDatabase()): boolean {
  if (!getConfig().demoMode || profileId !== "system-administrator") return false;
  return Boolean(db.prepare("SELECT 1 FROM demo_profiles WHERE id=? AND is_system_administrator=1").get(profileId));
}

export function canManageCollectionRule(
  profileId: DemoProfileId,
  ruleId: string,
  db: DatabaseSync = openDatabase(),
): boolean {
  if (!isSystemAdministrator(profileId, db)) return false;
  const rule = db.prepare(
    `SELECT r.managing_profile_id,r.management_blocked,r.recipient_profile_id,r.collection_id,g.can_read,
            rg.can_contribute AS recipient_can_contribute
     FROM collection_rules r
     LEFT JOIN collection_grants g ON g.profile_id=? AND g.collection_id=r.collection_id
     LEFT JOIN collection_grants rg ON rg.profile_id=r.recipient_profile_id AND rg.collection_id=r.collection_id
     WHERE r.id=? AND r.archived_at IS NULL`,
  ).get(profileId, ruleId) as {
    managing_profile_id: DemoProfileId | null;
    management_blocked: number;
    recipient_profile_id: DemoProfileId;
    can_read: number | null;
    recipient_can_contribute: number | null;
  } | undefined;
  return Boolean(rule && !rule.management_blocked && rule.managing_profile_id === profileId && rule.can_read && rule.recipient_can_contribute);
}

export function canReadCollectionPeriod(
  profileId: DemoProfileId,
  periodId: string,
  db: DatabaseSync = openDatabase(),
): boolean {
  if (!getConfig().demoMode) return false;
  const period = db.prepare(
    `SELECT p.recipient_profile_id,p.collection_id,rg.can_contribute AS recipient_can_contribute,
            g.can_organize
     FROM collection_periods p
     LEFT JOIN collection_grants rg ON rg.profile_id=p.recipient_profile_id AND rg.collection_id=p.collection_id
     LEFT JOIN collection_grants g ON g.profile_id=? AND g.collection_id=p.collection_id
     WHERE p.id=?`,
  ).get(profileId, periodId) as {
    recipient_profile_id: DemoProfileId;
    recipient_can_contribute: number | null;
    can_organize: number | null;
  } | undefined;
  return Boolean(period && period.recipient_can_contribute &&
    (period.recipient_profile_id === profileId || period.can_organize));
}

export function canManageAgentSchedule(
  profileId: DemoProfileId,
  scheduleId: string,
  db: DatabaseSync = openDatabase(),
): boolean {
  if (!isSystemAdministrator(profileId, db)) return false;
  const schedule = db.prepare(
    `SELECT s.managing_profile_id,s.management_blocked,s.rule_id,s.collection_id,g.can_read
     FROM agent_schedules s
     LEFT JOIN collection_grants g ON g.profile_id=? AND g.collection_id=s.collection_id
     WHERE s.id=?`,
  ).get(profileId, scheduleId) as {
    managing_profile_id: DemoProfileId | null;
    management_blocked: number;
    rule_id: string | null;
    can_read: number | null;
  } | undefined;
  if (!schedule || schedule.management_blocked || schedule.managing_profile_id !== profileId || !schedule.can_read) return false;
  if (schedule.rule_id) return canManageCollectionRule(profileId, schedule.rule_id, db);
  return true;
}
