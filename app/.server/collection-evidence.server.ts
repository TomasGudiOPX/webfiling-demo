import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CollectionRuleDefinition, DemoProfileId } from "../types";
import { getConfig } from "./config";
import { openDatabase } from "./db.server";
import { collectionCapabilities } from "./file-access.server";
import { canReadCollectionPeriod } from "./agent-access.server";
import { collectionRuleDefinition } from "./collection-rules.server";
import { evaluateCollectionPeriod, evaluatePeriodInTransaction } from "./collection-periods.server";
import { transaction } from "./sqlite-transaction.server";

export type EvidenceResolution = { periodId: string; slotKey: string };
export type EvidenceMatchResult =
  | { status: "not_matched" }
  | { status: "already_linked"; periodId: string; slotKey: string }
  | { status: "linked"; periodId: string; slotKey: string; late: boolean }
  | { status: "ambiguous"; choices: Array<{ periodId: string; slotKey: string; label: string; closesAt: string }> };

type MatchCandidate = { periodId: string; ruleId: string; ruleVersion: number; slotKey: string; label: string; closesAt: string; late: boolean };

function fileMatches(definition: CollectionRuleDefinition, slotKey: string, file: {
  filename: string; extension: string; category_id: string | null; discipline_tag: string | null; location_tag: string | null;
}, projectIds: Set<string>, ruleProjectId: string | null): boolean {
  const slot = definition.slots.find((entry) => entry.key === slotKey);
  if (!slot || !slot.allowedExtensions.includes(file.extension.toLowerCase())) return false;
  if (ruleProjectId && !projectIds.has(ruleProjectId)) return false;
  const criteria = slot.criteria;
  return (!criteria.filenameIncludes || file.filename.toLocaleLowerCase().includes(criteria.filenameIncludes.toLocaleLowerCase())) &&
    (!criteria.categoryId || criteria.categoryId === file.category_id) &&
    (!criteria.disciplineTag || criteria.disciplineTag === file.discipline_tag) &&
    (!criteria.locationTag || criteria.locationTag === file.location_tag);
}

function candidatesForUpload(profileId: DemoProfileId, fileId: string, db: DatabaseSync): { uploadedAt: string; collectionId: string; candidates: MatchCandidate[] } | null {
  const file = db.prepare(
    `SELECT f.id,f.filename,f.extension,f.category_id,f.discipline_tag,f.location_tag,
            m.collection_id,m.origin,m.contributor_id,m.trashed_at
     FROM files f JOIN library_file_metadata m ON m.file_id=f.id WHERE f.id=?`,
  ).get(fileId) as {
    id: string; filename: string; extension: string; category_id: string | null;
    discipline_tag: string | null; location_tag: string | null; collection_id: string;
    origin: string; contributor_id: string | null; trashed_at: string | null;
  } | undefined;
  if (!file || file.origin !== "managed_upload" || file.contributor_id !== profileId || file.trashed_at)
    return null;
  const uploadEvent = db.prepare(
    "SELECT actor_id,occurred_at FROM file_events WHERE file_id=? AND event_type='uploaded' ORDER BY occurred_at,id LIMIT 1",
  ).get(fileId) as { actor_id: string; occurred_at: string } | undefined;
  if (!uploadEvent || uploadEvent.actor_id !== profileId) return null;
  if (!collectionCapabilities(profileId, file.collection_id, db).canContribute) return null;
  const projectIds = new Set((db.prepare("SELECT project_id FROM file_projects WHERE file_id=?").all(fileId) as Array<{ project_id: string }>).map((row) => row.project_id));
  const periods = db.prepare(
    `SELECT p.id,p.rule_id,p.rule_version,p.opens_at,p.closes_at,p.recipient_profile_id,p.collection_id,p.status,p.cancelled_at,p.superseded_at,r.project_id
     FROM collection_periods p JOIN collection_rules r ON r.id=p.rule_id
     WHERE p.collection_id=? AND p.recipient_profile_id=? AND p.status NOT IN ('cancelled') AND p.cancelled_at IS NULL AND p.superseded_at IS NULL
     ORDER BY p.opens_at,p.id`,
  ).all(file.collection_id, profileId) as Array<{
    id: string; rule_id: string; rule_version: number; opens_at: string; closes_at: string;
    recipient_profile_id: DemoProfileId; collection_id: string; status: string; cancelled_at: string | null;
    superseded_at: string | null; project_id: string | null;
  }>;
  const candidates: MatchCandidate[] = [];
  for (const period of periods) {
    if (period.recipient_profile_id !== profileId || period.collection_id !== file.collection_id) continue;
    const existing = db.prepare("SELECT slot_key,active FROM collection_evidence WHERE period_id=? AND file_id=?").get(period.id) as { slot_key: string; active: number } | undefined;
    if (existing) continue;
    const uploadedAt = new Date(uploadEvent.occurred_at).getTime();
    const opensAt = new Date(period.opens_at).getTime();
    const closesAt = new Date(period.closes_at).getTime();
    const late = uploadedAt > closesAt;
    if (uploadedAt < opensAt) continue;
    const definition = collectionRuleDefinition(period.rule_id, period.rule_version, db);
    for (const slot of definition.slots) {
      const count = (db.prepare("SELECT count(*) AS count FROM collection_evidence WHERE period_id=? AND slot_key=? AND active=1").get(period.id, slot.key) as { count: number }).count;
      if (count >= slot.requiredCount) continue;
      if (!fileMatches(definition, slot.key, file, projectIds, period.project_id)) continue;
      candidates.push({ periodId: period.id, ruleId: period.rule_id, ruleVersion: period.rule_version, slotKey: slot.key, label: slot.label, closesAt: period.closes_at, late });
    }
  }
  return { uploadedAt: uploadEvent.occurred_at, collectionId: file.collection_id, candidates };
}

export function matchManagedUploadEvidence(
  profileId: DemoProfileId,
  fileId: string,
  resolution?: EvidenceResolution,
  db = openDatabase(),
  linkedAt = new Date(),
): EvidenceMatchResult {
  if (!getConfig().demoMode) return { status: "not_matched" };
  const candidateSet = candidatesForUpload(profileId, fileId, db);
  if (!candidateSet) return { status: "not_matched" };
  if (!candidateSet.candidates.length) {
    const existing = db.prepare(
      `SELECT e.period_id,e.slot_key FROM collection_evidence e JOIN collection_periods p ON p.id=e.period_id
       WHERE e.file_id=? AND e.contributor_profile_id=? AND p.recipient_profile_id=? ORDER BY e.linked_at LIMIT 1`,
    ).get(fileId, profileId, profileId) as { period_id: string; slot_key: string } | undefined;
    if (existing && canReadCollectionPeriod(profileId, existing.period_id, db))
      return { status: "already_linked", periodId: existing.period_id, slotKey: existing.slot_key };
    return { status: "not_matched" };
  }
  const candidates = candidateSet.candidates;
  let selected: MatchCandidate | undefined;
  if (resolution) {
    selected = candidates.find((candidate) => candidate.periodId === resolution.periodId && candidate.slotKey === resolution.slotKey);
    if (!selected) return { status: "not_matched" };
  } else if (candidates.length === 1) {
    if (candidates[0].late)
      return { status: "ambiguous", choices: candidates.map(({ periodId, slotKey, label, closesAt }) => ({ periodId, slotKey, label, closesAt })) };
    selected = candidates[0];
  } else {
    return {
      status: "ambiguous",
      choices: candidates.slice(0, 30).map(({ periodId, slotKey, label, closesAt }) => ({ periodId, slotKey, label, closesAt })),
    };
  }
  const timestamp = linkedAt.toISOString();
  const result = transaction(db, () => {
    const current = candidatesForUpload(profileId, fileId, db);
    const stillMatches = current?.candidates.find((candidate) => candidate.periodId === selected!.periodId && candidate.slotKey === selected!.slotKey);
    if (!stillMatches) return { status: "not_matched" } as const;
    const inserted = db.prepare(
      `INSERT OR IGNORE INTO collection_evidence
       (id,period_id,slot_key,file_id,contributor_profile_id,uploaded_at,linked_at,linked_by,is_late,active)
       VALUES (?,?,?,?,?,?,?,?,?,1)`,
    ).run(randomUUID(), stillMatches.periodId, stillMatches.slotKey, fileId, profileId, current!.uploadedAt, timestamp, profileId, stillMatches.late ? 1 : 0);
    if (!inserted.changes) {
      const existing = db.prepare("SELECT slot_key FROM collection_evidence WHERE period_id=? AND file_id=?").get(stillMatches.periodId, fileId) as { slot_key: string } | undefined;
      return existing ? { status: "already_linked", periodId: stillMatches.periodId, slotKey: existing.slot_key } as const : { status: "not_matched" } as const;
    }
    db.prepare("INSERT INTO collection_events (id,period_id,event_type,actor_profile_id,occurred_at,details_json) VALUES (?,?,?,?,?,?)")
      .run(randomUUID(), stillMatches.periodId, "evidence_linked", profileId, timestamp, JSON.stringify({ fileId, slotKey: stillMatches.slotKey, late: stillMatches.late, uploadedAt: current!.uploadedAt }));
    return { status: "linked", periodId: stillMatches.periodId, slotKey: stillMatches.slotKey, late: stillMatches.late } as const;
  });
  if (result.status === "linked") evaluateCollectionPeriod(result.periodId, linkedAt, db);
  return result;
}

export function reconcileFileEvidenceInTransaction(fileId: string, db: DatabaseSync, now = new Date()): number {
  const file = db.prepare(
    `SELECT f.filename,f.extension,f.category_id,f.discipline_tag,f.location_tag,
            m.collection_id,m.origin,m.contributor_id,m.trashed_at
     FROM files f JOIN library_file_metadata m ON m.file_id=f.id WHERE f.id=?`,
  ).get(fileId) as {
    filename: string; extension: string; category_id: string | null; discipline_tag: string | null;
    location_tag: string | null; collection_id: string; origin: string; contributor_id: string | null; trashed_at: string | null;
  } | undefined;
  if (!file) return 0;
  const uploadEvent = db.prepare(
    "SELECT actor_id,occurred_at FROM file_events WHERE file_id=? AND event_type='uploaded' ORDER BY occurred_at,id LIMIT 1",
  ).get(fileId) as { actor_id: string; occurred_at: string } | undefined;
  const projectIds = new Set((db.prepare("SELECT project_id FROM file_projects WHERE file_id=?").all(fileId) as Array<{ project_id: string }>).map((row) => row.project_id));
  const links = db.prepare(
    `SELECT e.id,e.period_id,e.slot_key,e.contributor_profile_id,e.uploaded_at,e.is_late,e.active,
            p.rule_id,p.rule_version,p.recipient_profile_id,p.collection_id,p.opens_at,p.closes_at,p.cancelled_at,p.superseded_at,
            r.project_id
     FROM collection_evidence e JOIN collection_periods p ON p.id=e.period_id JOIN collection_rules r ON r.id=p.rule_id
     WHERE e.file_id=?`,
  ).all(fileId) as Array<{
    id: string; period_id: string; slot_key: string; contributor_profile_id: string; uploaded_at: string;
    is_late: number; active: number; rule_id: string; rule_version: number; recipient_profile_id: DemoProfileId;
    collection_id: string; opens_at: string; closes_at: string; cancelled_at: string | null; superseded_at: string | null;
    project_id: string | null;
  }>;
  let changes = 0;
  const periods = new Set<string>();
  for (const link of links) {
    const definition = collectionRuleDefinition(link.rule_id, link.rule_version, db);
    const uploadedAt = new Date(link.uploaded_at).getTime();
    const opensAt = new Date(link.opens_at).getTime();
    const closesAt = new Date(link.closes_at).getTime();
    const timeValid = Boolean(uploadEvent) && link.uploaded_at === uploadEvent?.occurred_at &&
      (link.is_late ? uploadedAt > closesAt : uploadedAt >= opensAt && uploadedAt <= closesAt);
    const valid = file.origin === "managed_upload" && Boolean(uploadEvent) &&
      uploadEvent?.actor_id === link.contributor_profile_id &&
      file.contributor_id === link.contributor_profile_id &&
      link.recipient_profile_id === link.contributor_profile_id &&
      file.collection_id === link.collection_id && timeValid &&
      !file.trashed_at &&
      fileMatches(definition, link.slot_key, file, projectIds, link.project_id);
    const shouldBeActive = valid;
    if (Boolean(link.active) === shouldBeActive) continue;
    db.prepare("UPDATE collection_evidence SET active=?,inactive_reason=? WHERE id=?")
      .run(shouldBeActive ? 1 : 0, shouldBeActive ? null : file.trashed_at ? "trashed" : "criteria_changed", link.id);
    const occurredAt = now.toISOString();
    db.prepare("INSERT INTO collection_events (id,period_id,event_type,actor_profile_id,occurred_at,details_json) VALUES (?,?,?,?,?,?)")
      .run(randomUUID(), link.period_id, shouldBeActive ? "evidence_reactivated" : "evidence_deactivated",
        null, occurredAt, JSON.stringify({ fileId, slotKey: link.slot_key, reason: shouldBeActive ? null : file.trashed_at ? "trashed" : "criteria_changed" }));
    periods.add(link.period_id);
    changes++;
  }
  for (const periodId of periods) evaluatePeriodInTransaction(periodId, now, db);
  return changes;
}

export function reconcileFileEvidence(
  fileId: string,
  eventType: "uploaded" | "metadata_changed" | "projects_changed" | "renamed" | "moved" | "trashed" | "restored",
  db = openDatabase(),
  now = new Date(),
): EvidenceMatchResult | { status: "reconciled"; changes: number } {
  if (!getConfig().demoMode) return { status: "not_matched" };
  if (eventType === "uploaded") {
    const upload = db.prepare("SELECT contributor_id FROM library_file_metadata WHERE file_id=?").get(fileId) as { contributor_id: DemoProfileId | null } | undefined;
    return upload?.contributor_id
      ? matchManagedUploadEvidence(upload.contributor_id, fileId, undefined, db, now)
      : { status: "not_matched" };
  }
  const changes = transaction(db, () => reconcileFileEvidenceInTransaction(fileId, db, now));
  return { status: "reconciled", changes };
}

export function replayRecentUploadEvidence(db = openDatabase(), now = new Date(), limit = 100): EvidenceMatchResult[] {
  if (!getConfig().demoMode || !Number.isInteger(limit) || limit < 1 || limit > 1000) return [];
  const uploads = db.prepare(
    `SELECT e.file_id,e.actor_id FROM file_events e JOIN library_file_metadata m ON m.file_id=e.file_id
     WHERE e.event_type='uploaded' AND m.origin='managed_upload' ORDER BY e.occurred_at DESC,e.id DESC LIMIT ?`,
  ).all(limit) as Array<{ file_id: string; actor_id: string }>;
  const profiles = new Set<DemoProfileId>(["employee", "manager", "administration-staff", "system-administrator"]);
  return uploads.flatMap((upload) => {
    if (!profiles.has(upload.actor_id as DemoProfileId)) return [];
    const result = matchManagedUploadEvidence(upload.actor_id as DemoProfileId, upload.file_id, undefined, db, now);
    transaction(db, () => reconcileFileEvidenceInTransaction(upload.file_id, db, now));
    return [result];
  });
}
