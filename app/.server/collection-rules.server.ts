import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  DOCUMENT_CATEGORIES, DISCIPLINE_TAGS, LOCATION_TAGS,
  type CollectionRuleDefinition, type CollectionRuleSlot, type DemoProfileId,
} from "../types";
import { canManageCollectionRule, isSystemAdministrator } from "./agent-access.server";
import { getConfig } from "./config";
import { openDatabase } from "./db.server";
import { collectionCapabilities } from "./file-access.server";
import { FileInputError } from "./upload-validation.server";
import { transaction } from "./sqlite-transaction.server";
import {
  assertNoOverlappingWindows, previewCollectionWindows,
  type CollectionRecurrence,
} from "./schedule-window.server";

const profileIds = new Set<DemoProfileId>(["employee", "manager", "administration-staff", "system-administrator"]);
const categories = new Set(DOCUMENT_CATEGORIES.map((item) => item.id));
const disciplines = new Set(Object.keys(DISCIPLINE_TAGS));
const locations = new Set(Object.keys(LOCATION_TAGS));
const supportedExtensions = new Set([".pdf", ".docx", ".md", ".markdown", ".txt", ".png", ".jpg", ".jpeg", ".webp"]);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

export class RuleInputError extends Error {
  constructor(readonly code: "invalid" | "not_found" | "forbidden" | "conflict", readonly status: 400 | 403 | 404 | 409) {
    super(code === "not_found" ? "Regla o destino no disponible." : code === "forbidden" ? "Acción no permitida." : code === "conflict" ? "La regla cambió. Actualiza e inténtalo de nuevo." : "Revisa los campos de la regla.");
  }
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RuleInputError("invalid", 400);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key))) throw new RuleInputError("invalid", 400);
  return result;
}
function validId(value: unknown, optional = false): string | null {
  if (optional && value === undefined) return null;
  if (optional && value === null) return null;
  if (typeof value !== "string" || !idPattern.test(value)) throw new RuleInputError("invalid", 400);
  return value;
}
function enumId<T extends string>(value: unknown, allowed: Set<string>, label: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.has(value)) throw new RuleInputError("invalid", 400);
  return value as T;
}

function parseRecurrence(value: unknown): CollectionRecurrence {
  const input = object(value, ["kind", "timezone", "opensAt", "closesAt", "weekday", "day", "hour", "minute", "windowMinutes", "expression"]);
  const timezone = input.timezone;
  if (typeof timezone !== "string" || timezone.length > 80) throw new RuleInputError("invalid", 400);
  if (input.kind === "one_off") {
    if (typeof input.opensAt !== "string" || typeof input.closesAt !== "string") throw new RuleInputError("invalid", 400);
    return { kind: "one_off", timezone, opensAt: input.opensAt, closesAt: input.closesAt };
  }
  if (!Number.isInteger(input.hour) || !Number.isInteger(input.minute) || !Number.isInteger(input.windowMinutes))
    throw new RuleInputError("invalid", 400);
  const base = { timezone, hour: Number(input.hour), minute: Number(input.minute), windowMinutes: Number(input.windowMinutes) };
  if (input.kind === "weekly") return { kind: "weekly", ...base, weekday: Number(input.weekday) };
  if (input.kind === "monthly") return { kind: "monthly", ...base, day: Number(input.day) };
  if (input.kind === "cron" && typeof input.expression === "string") return { kind: "cron", timezone, expression: input.expression, windowMinutes: Number(input.windowMinutes) };
  throw new RuleInputError("invalid", 400);
}

function parseDefinition(value: unknown): CollectionRuleDefinition {
  const input = object(value, ["slots", "organizationDefaults", "recurrence"]);
  if (!Array.isArray(input.slots) || input.slots.length < 1 || input.slots.length > 10)
    throw new RuleInputError("invalid", 400);
  const keys = new Set<string>();
  const slots: CollectionRuleSlot[] = input.slots.map((entry) => {
    const slot = object(entry, ["key", "label", "requiredCount", "allowedExtensions", "criteria"]);
    if (typeof slot.key !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(slot.key) || keys.has(slot.key))
      throw new RuleInputError("invalid", 400);
    keys.add(slot.key);
    if (typeof slot.label !== "string" || !slot.label.trim() || slot.label.trim().length > 80 || !Number.isInteger(slot.requiredCount) || Number(slot.requiredCount) < 1 || Number(slot.requiredCount) > 20)
      throw new RuleInputError("invalid", 400);
    if (!Array.isArray(slot.allowedExtensions) || slot.allowedExtensions.length < 1 || slot.allowedExtensions.length > 9)
      throw new RuleInputError("invalid", 400);
    const extensions = slot.allowedExtensions.map((extension) => {
      if (typeof extension !== "string") throw new RuleInputError("invalid", 400);
      const normalized = extension.toLowerCase().startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
      if (!supportedExtensions.has(normalized)) throw new RuleInputError("invalid", 400);
      return normalized;
    });
    if (new Set(extensions).size !== extensions.length) throw new RuleInputError("invalid", 400);
    const criteriaInput = object(slot.criteria ?? {}, ["filenameIncludes", "categoryId", "disciplineTag", "locationTag"]);
    const criteria: CollectionRuleSlot["criteria"] = {};
    if (criteriaInput.filenameIncludes !== undefined) {
      if (typeof criteriaInput.filenameIncludes !== "string" || !criteriaInput.filenameIncludes.trim() || criteriaInput.filenameIncludes.trim().length > 80)
        throw new RuleInputError("invalid", 400);
      criteria.filenameIncludes = criteriaInput.filenameIncludes.trim();
    }
    const categoryId = enumId<NonNullable<CollectionRuleSlot["criteria"]["categoryId"]>>(criteriaInput.categoryId, categories, "category");
    const disciplineTag = enumId<NonNullable<CollectionRuleSlot["criteria"]["disciplineTag"]>>(criteriaInput.disciplineTag, disciplines, "discipline");
    const locationTag = enumId<NonNullable<CollectionRuleSlot["criteria"]["locationTag"]>>(criteriaInput.locationTag, locations, "location");
    if (categoryId) criteria.categoryId = categoryId;
    if (disciplineTag) criteria.disciplineTag = disciplineTag;
    if (locationTag) criteria.locationTag = locationTag;
    return { key: slot.key, label: slot.label.trim(), requiredCount: Number(slot.requiredCount), allowedExtensions: [...new Set(extensions)], criteria };
  });
  const defaultsInput = object(input.organizationDefaults ?? {}, ["categoryId", "disciplineTag", "locationTag", "folderId"]);
  const organizationDefaults: CollectionRuleDefinition["organizationDefaults"] = {};
  const categoryId = enumId<NonNullable<CollectionRuleDefinition["organizationDefaults"]["categoryId"]>>(defaultsInput.categoryId, categories, "category");
  const disciplineTag = enumId<NonNullable<CollectionRuleDefinition["organizationDefaults"]["disciplineTag"]>>(defaultsInput.disciplineTag, disciplines, "discipline");
  const locationTag = enumId<NonNullable<CollectionRuleDefinition["organizationDefaults"]["locationTag"]>>(defaultsInput.locationTag, locations, "location");
  if (categoryId) organizationDefaults.categoryId = categoryId;
  if (disciplineTag) organizationDefaults.disciplineTag = disciplineTag;
  if (locationTag) organizationDefaults.locationTag = locationTag;
  if (defaultsInput.folderId !== undefined) organizationDefaults.folderId = validId(defaultsInput.folderId, true);
  const recurrence = parseRecurrence(input.recurrence);
  for (const slot of slots) {
    if (organizationDefaults.categoryId && slot.criteria.categoryId && organizationDefaults.categoryId !== slot.criteria.categoryId)
      throw new RuleInputError("invalid", 400);
    if (organizationDefaults.disciplineTag && slot.criteria.disciplineTag && organizationDefaults.disciplineTag !== slot.criteria.disciplineTag)
      throw new RuleInputError("invalid", 400);
    if (organizationDefaults.locationTag && slot.criteria.locationTag && organizationDefaults.locationTag !== slot.criteria.locationTag)
      throw new RuleInputError("invalid", 400);
  }
  return { slots, organizationDefaults, recurrence };
}

function assertRuleAuthority(profileId: DemoProfileId, recipientId: DemoProfileId, collectionId: string, db: DatabaseSync) {
  if (!isSystemAdministrator(profileId, db)) throw new RuleInputError("forbidden", 403);
  const actor = collectionCapabilities(profileId, collectionId, db);
  if (!actor.canRead) throw new RuleInputError("not_found", 404);
  const recipient = collectionCapabilities(recipientId, collectionId, db);
  if (!recipient.canContribute) throw new RuleInputError("not_found", 404);
}

function validateScope(collectionId: string, projectId: string | null, definition: CollectionRuleDefinition, db: DatabaseSync, now = new Date()) {
  if (projectId && !db.prepare("SELECT 1 FROM collections WHERE id=? AND project_id=?").get(collectionId, projectId))
    throw new RuleInputError("not_found", 404);
  const folderId = definition.organizationDefaults.folderId ?? null;
  if (folderId && !db.prepare("SELECT 1 FROM managed_folders WHERE id=? AND collection_id=?").get(folderId, collectionId))
    throw new RuleInputError("not_found", 404);
  try {
    const windows = previewCollectionWindows(definition.recurrence as CollectionRecurrence, now, 12);
    assertNoOverlappingWindows(windows);
  } catch {
    throw new RuleInputError("invalid", 400);
  }
}

function serializeDefinition(definition: CollectionRuleDefinition) {
  return JSON.stringify(definition);
}
function ruleDto(row: Record<string, unknown>, definition: CollectionRuleDefinition) {
  return {
    id: String(row.id), creatorProfileId: String(row.creator_profile_id),
    managingProfileId: row.managing_profile_id === null ? null : String(row.managing_profile_id),
    managementBlocked: Boolean(row.management_blocked),
    recipientProfileId: String(row.recipient_profile_id) as DemoProfileId,
    collectionId: String(row.collection_id), projectId: row.project_id === null ? null : String(row.project_id),
    version: Number(row.current_version), enabled: Boolean(row.enabled),
    paused: row.paused_at !== null, archivedAt: row.archived_at === null ? null : String(row.archived_at),
    definition, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function getRuleRow(ruleId: string, db: DatabaseSync) {
  const row = db.prepare("SELECT * FROM collection_rules WHERE id=?").get(ruleId) as Record<string, unknown> | undefined;
  if (!row) throw new RuleInputError("not_found", 404);
  const version = db.prepare("SELECT definition_json FROM collection_rule_versions WHERE rule_id=? AND version=?").get(ruleId, Number(row.current_version)) as { definition_json: string } | undefined;
  if (!version) throw new RuleInputError("not_found", 404);
  let definition: CollectionRuleDefinition;
  try { definition = parseDefinition(JSON.parse(version.definition_json)); }
  catch { throw new RuleInputError("not_found", 404); }
  return { row, definition };
}

export function collectionRuleDefinition(ruleId: string, version: number, db = openDatabase()): CollectionRuleDefinition {
  const snapshot = db.prepare("SELECT definition_json FROM collection_rule_versions WHERE rule_id=? AND version=?").get(ruleId, version) as { definition_json: string } | undefined;
  if (!snapshot) throw new RuleInputError("not_found", 404);
  try { return parseDefinition(JSON.parse(snapshot.definition_json)); }
  catch { throw new RuleInputError("not_found", 404); }
}

function recordRuleEvent(db: DatabaseSync, ruleId: string, actor: DemoProfileId, eventType: string, version: number, details: Record<string, unknown>, now: string) {
  db.prepare("INSERT INTO collection_rule_events (id,rule_id,actor_profile_id,event_type,version,occurred_at,details_json) VALUES (?,?,?,?,?,?,?)")
    .run(randomUUID(), ruleId, actor, eventType, version, now, JSON.stringify(details));
}

function writeVersion(db: DatabaseSync, ruleId: string, version: number, creator: DemoProfileId, definition: CollectionRuleDefinition, now: string) {
  const recurrence = definition.recurrence as CollectionRecurrence;
  const cron = recurrence.kind === "cron" ? recurrence.expression
    : recurrence.kind === "weekly" ? `${recurrence.minute} ${recurrence.hour} * * ${recurrence.weekday}`
      : recurrence.kind === "monthly" ? `${recurrence.minute} ${recurrence.hour} ${recurrence.day} * *` : null;
  db.prepare(
    `INSERT INTO collection_rule_versions
     (rule_id,version,definition_json,timezone,opening_cron,window_start,window_end,window_minutes,created_by,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(ruleId, version, serializeDefinition(definition), recurrence.timezone, cron,
    recurrence.kind === "one_off" ? recurrence.opensAt : null,
    recurrence.kind === "one_off" ? recurrence.closesAt : null,
    recurrence.kind === "one_off" ? null : recurrence.windowMinutes, creator, now);
}

export function createCollectionRule(profileId: DemoProfileId, value: unknown, db = openDatabase(), now = new Date()) {
  return transaction(db, () => createCollectionRuleInTransaction(profileId, value, db, now));
}

export function createCollectionRuleInTransaction(profileId: DemoProfileId, value: unknown, db: DatabaseSync, now = new Date()) {
  if (!getConfig().demoMode) throw new RuleInputError("not_found", 404);
  const input = object(value, ["recipientProfileId", "collectionId", "projectId", "definition"]);
  const recipientId = input.recipientProfileId;
  if (typeof recipientId !== "string" || !profileIds.has(recipientId as DemoProfileId)) throw new RuleInputError("invalid", 400);
  const collectionId = validId(input.collectionId)!;
  const projectId = validId(input.projectId, true);
  const definition = parseDefinition(input.definition);
  assertRuleAuthority(profileId, recipientId as DemoProfileId, collectionId, db);
  validateScope(collectionId, projectId, definition, db);
  const id = randomUUID();
  const timestamp = now.toISOString();
  db.prepare(
    `INSERT INTO collection_rules
     (id,creator_profile_id,managing_profile_id,management_blocked,recipient_profile_id,collection_id,project_id,managed_folder_id,current_version,enabled,created_at,updated_at)
     VALUES (?,?,?,0,?,?,?,?,1,0,?,?)`,
  ).run(id, profileId, profileId, recipientId, collectionId, projectId, definition.organizationDefaults.folderId ?? null, timestamp, timestamp);
  writeVersion(db, id, 1, profileId, definition, timestamp);
  recordRuleEvent(db, id, profileId, "created", 1, {}, timestamp);
  return ruleDto(db.prepare("SELECT * FROM collection_rules WHERE id=?").get(id) as Record<string, unknown>, definition);
}

export function updateCollectionRule(profileId: DemoProfileId, ruleId: string, value: unknown, db = openDatabase(), now = new Date()) {
  if (!getConfig().demoMode) throw new RuleInputError("not_found", 404);
  if (!isSystemAdministrator(profileId, db)) throw new RuleInputError("forbidden", 403);
  const input = object(value, ["version", "projectId", "definition"]);
  const { row } = getRuleRow(ruleId, db);
  if (!canManageCollectionRule(profileId, ruleId, db)) throw new RuleInputError("not_found", 404);
  if (!Number.isSafeInteger(input.version) || Number(input.version) !== Number(row.current_version)) throw new RuleInputError("conflict", 409);
  const projectId = validId(input.projectId, true);
  const definition = parseDefinition(input.definition);
  const collectionId = String(row.collection_id);
  validateScope(collectionId, projectId, definition, db, now);
  return transaction(db, () => {
    const version = Number(row.current_version) + 1;
    const timestamp = now.toISOString();
    const result = db.prepare("UPDATE collection_rules SET project_id=?,managed_folder_id=?,current_version=?,updated_at=? WHERE id=? AND current_version=? AND archived_at IS NULL")
      .run(projectId, definition.organizationDefaults.folderId ?? null, version, timestamp, ruleId, Number(row.current_version));
    if (!result.changes) throw new RuleInputError("conflict", 409);
    writeVersion(db, ruleId, version, profileId, definition, timestamp);
    const upcoming = db.prepare(
      "SELECT id FROM collection_periods WHERE rule_id=? AND status='upcoming' AND superseded_at IS NULL AND opens_at>? AND rule_version<?",
    ).all(ruleId, timestamp, version) as Array<{ id: string }>;
    for (const period of upcoming) {
      db.prepare("UPDATE collection_periods SET superseded_at=? WHERE id=? AND status='upcoming'").run(timestamp, period.id);
      db.prepare("INSERT INTO collection_events (id,period_id,event_type,actor_profile_id,occurred_at,details_json) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), period.id, "superseded", profileId, timestamp, JSON.stringify({ fromVersion: Number(row.current_version), toVersion: version }));
    }
    recordRuleEvent(db, ruleId, profileId, "updated", version, {}, timestamp);
    return ruleDto(db.prepare("SELECT * FROM collection_rules WHERE id=?").get(ruleId) as Record<string, unknown>, definition);
  });
}

export function setCollectionRuleState(profileId: DemoProfileId, ruleId: string, intent: "enable" | "disable" | "pause" | "resume" | "archive" | "adopt", version: number, db = openDatabase(), now = new Date()) {
  if (!getConfig().demoMode) throw new RuleInputError("not_found", 404);
  if (!isSystemAdministrator(profileId, db)) throw new RuleInputError("forbidden", 403);
  const { row, definition } = getRuleRow(ruleId, db);
  if (intent === "adopt") {
    if (!row.management_blocked || !Number.isSafeInteger(version) || version !== Number(row.current_version)) throw new RuleInputError("conflict", 409);
    assertRuleAuthority(profileId, String(row.recipient_profile_id) as DemoProfileId, String(row.collection_id), db);
    return transaction(db, () => {
      const result = db.prepare("UPDATE collection_rules SET managing_profile_id=?,management_blocked=0,updated_at=? WHERE id=? AND management_blocked=1 AND current_version=? AND archived_at IS NULL")
        .run(profileId, now.toISOString(), ruleId, version);
      if (!result.changes) throw new RuleInputError("conflict", 409);
      recordRuleEvent(db, ruleId, profileId, "adopted", version, { priorCreatorProfileId: row.creator_profile_id }, now.toISOString());
      return ruleDto(db.prepare("SELECT * FROM collection_rules WHERE id=?").get(ruleId) as Record<string, unknown>, definition);
    });
  }
  if (!canManageCollectionRule(profileId, ruleId, db)) throw new RuleInputError("not_found", 404);
  if (!Number.isSafeInteger(version) || version !== Number(row.current_version)) throw new RuleInputError("conflict", 409);
  if (intent === "enable") validateScope(String(row.collection_id), row.project_id === null ? null : String(row.project_id), definition, db, now);
  const timestamp = now.toISOString();
  return transaction(db, () => {
    if (intent === "archive") {
      db.prepare("UPDATE collection_rules SET archived_at=?,enabled=0,paused_at=COALESCE(paused_at,?),updated_at=? WHERE id=? AND current_version=? AND archived_at IS NULL")
        .run(timestamp, timestamp, timestamp, ruleId, version);
    } else if (intent === "enable" || intent === "disable") {
      db.prepare("UPDATE collection_rules SET enabled=?,updated_at=? WHERE id=? AND current_version=? AND archived_at IS NULL")
        .run(intent === "enable" ? 1 : 0, timestamp, ruleId, version);
    } else {
      db.prepare("UPDATE collection_rules SET paused_at=?,updated_at=? WHERE id=? AND current_version=? AND archived_at IS NULL")
        .run(intent === "pause" ? timestamp : null, timestamp, ruleId, version);
    }
    recordRuleEvent(db, ruleId, profileId, intent === "enable" ? "enabled" : intent === "disable" ? "disabled" : intent, version, {}, timestamp);
    return ruleDto(db.prepare("SELECT * FROM collection_rules WHERE id=?").get(ruleId) as Record<string, unknown>, definition);
  });
}

export function listCollectionRules(profileId: DemoProfileId, db = openDatabase()) {
  if (!getConfig().demoMode) throw new RuleInputError("not_found", 404);
  const rows = db.prepare("SELECT * FROM collection_rules WHERE archived_at IS NULL AND recipient_profile_id=? ORDER BY created_at DESC")
    .all(profileId) as Array<Record<string, unknown>>;
  const adminRows = isSystemAdministrator(profileId, db) ? db.prepare("SELECT * FROM collection_rules WHERE archived_at IS NULL ORDER BY created_at DESC").all() as Array<Record<string, unknown>> : [];
  const unique = new Map<string, Record<string, unknown>>([...rows, ...adminRows].map((row) => [String(row.id), row]));
  return [...unique.values()].flatMap((row) => {
    const recipientCanRead = row.recipient_profile_id === profileId && collectionCapabilities(profileId, String(row.collection_id), db).canRead;
    if (!recipientCanRead && !canManageCollectionRule(profileId, String(row.id), db) && !(isSystemAdministrator(profileId, db) && Boolean(row.management_blocked))) return [];
    const version = db.prepare("SELECT definition_json FROM collection_rule_versions WHERE rule_id=? AND version=?").get(String(row.id), Number(row.current_version)) as { definition_json: string } | undefined;
    if (!version) return [];
    try { return [ruleDto(row, parseDefinition(JSON.parse(version.definition_json)))]; }
    catch { return []; }
  });
}

export function getCollectionRule(profileId: DemoProfileId, ruleId: string, db = openDatabase()) {
  if (!getConfig().demoMode) throw new RuleInputError("not_found", 404);
  const { row, definition } = getRuleRow(ruleId, db);
  const recipientCanRead = row.recipient_profile_id === profileId && collectionCapabilities(profileId, String(row.collection_id), db).canRead;
  if (!recipientCanRead && !canManageCollectionRule(profileId, ruleId, db)) throw new RuleInputError("not_found", 404);
  return ruleDto(row, definition);
}
