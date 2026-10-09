import type { DatabaseSync } from "node:sqlite";
import type { DemoProfileId } from "../types";
import { collectionRuleDefinition } from "./collection-rules.server";
import { validateFolder, fileEvent } from "./library-management.server";

export type DefaultsApplication = { status: "none" | "applied" | "conflict" | "unavailable"; ruleIds: string[] };

export function applyCollectionRuleDefaultsInTransaction(
  profileId: DemoProfileId,
  file: { id: string; collectionId: string; filename: string; extension: string; projectIds: string[]; folderExplicit: boolean },
  db: DatabaseSync,
): DefaultsApplication {
  const rules = db.prepare(
    `SELECT id,current_version,project_id FROM collection_rules
     WHERE recipient_profile_id=? AND collection_id=? AND enabled=1 AND archived_at IS NULL AND paused_at IS NULL
     ORDER BY id LIMIT 50`,
  ).all(profileId, file.collectionId) as Array<{ id: string; current_version: number; project_id: string | null }>;
  const matched: Array<{ id: string; version: number; defaults: ReturnType<typeof collectionRuleDefinition>["organizationDefaults"] }> = [];
  for (const rule of rules) {
    if (rule.project_id && !file.projectIds.includes(rule.project_id)) continue;
    const definition = collectionRuleDefinition(rule.id, rule.current_version, db);
    const defaults = definition.organizationDefaults;
    const categoryId = defaults.categoryId ?? null;
    const disciplineTag = defaults.disciplineTag ?? null;
    const locationTag = defaults.locationTag ?? null;
    const slotMatches = definition.slots.some((slot) => {
      const criteria = slot.criteria;
      return slot.allowedExtensions.includes(file.extension) &&
        (!criteria.filenameIncludes || file.filename.toLocaleLowerCase().includes(criteria.filenameIncludes.toLocaleLowerCase())) &&
        (!criteria.categoryId || criteria.categoryId === categoryId) &&
        (!criteria.disciplineTag || criteria.disciplineTag === disciplineTag) &&
        (!criteria.locationTag || criteria.locationTag === locationTag);
    });
    if (slotMatches && Object.keys(defaults).length) matched.push({ id: rule.id, version: rule.current_version, defaults });
  }
  if (!matched.length) return { status: "none", ruleIds: [] };
  const canonical = JSON.stringify(matched[0].defaults);
  const conflicts = matched.some((entry) => JSON.stringify(entry.defaults) !== canonical);
  if (conflicts) {
    const ruleIds = matched.map((entry) => entry.id);
    fileEvent(db, file.id, profileId, "organization_defaults_skipped", null, { reason: "conflicting_rules", ruleIds });
    return { status: "conflict", ruleIds };
  }
  const selected = matched[0];
  const defaults = selected.defaults;
  if (!file.folderExplicit && defaults.folderId) {
    try { validateFolder(file.collectionId, defaults.folderId, db); }
    catch { return { status: "unavailable", ruleIds: matched.map((entry) => entry.id) }; }
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE files SET category_id=?,discipline_tag=?,location_tag=?,updated_at=? WHERE id=?")
    .run(defaults.categoryId ?? null, defaults.disciplineTag ?? null, defaults.locationTag ?? null, now, file.id);
  if (!file.folderExplicit && defaults.folderId)
    db.prepare("UPDATE library_file_metadata SET managed_folder_id=?,updated_at=? WHERE file_id=?").run(defaults.folderId, now, file.id);
  fileEvent(db, file.id, profileId, "metadata_changed", null, {
    ...defaults,
    authorization: { kind: "collection_rule", ruleId: selected.id, version: selected.version },
  });
  return { status: "applied", ruleIds: matched.map((entry) => entry.id) };
}
