import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getConfig } from "./config";
import { scenarioRegistry } from "../scenarios";
import type {
  DocumentFile,
  FileStatus,
  Finding,
  FindingState,
  IndexHealth,
  PublicFile,
  PreviewDescriptor,
  Project,
  RelationGraph,
  ReviewDecision,
  SearchResult,
} from "../types";
import type { SearchFilters } from "../search-filters";
import { DOCUMENT_CATEGORIES } from "../types";

type SqliteDatabase = DatabaseSync;
let cached: SqliteDatabase | undefined;
let cachedPath: string | undefined;
const DEMO_SLUGS = scenarioRegistry.map((scenario) => scenario.slug);

const schema = `
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, source_root TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, demo_owned INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('project','shared','administration')), project_id TEXT UNIQUE REFERENCES projects(id), sample_owned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), stable_identity TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, source_path TEXT NOT NULL, extension TEXT NOT NULL DEFAULT '', size_bytes INTEGER NOT NULL DEFAULT 0, modified_at TEXT NOT NULL, document_type TEXT NOT NULL DEFAULT 'other', status TEXT NOT NULL, index_state TEXT NOT NULL DEFAULT 'indexed', metadata_text TEXT NOT NULL DEFAULT '', reviewer TEXT, reviewed_at TEXT, review_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, demo_owned INTEGER NOT NULL DEFAULT 0, preview_kind TEXT, preview_title TEXT, preview_url TEXT, preview_content TEXT, preview_sections TEXT, category_id TEXT, discipline_tag TEXT, location_tag TEXT);
CREATE INDEX IF NOT EXISTS idx_files_project_status ON files(project_id, status);
CREATE INDEX IF NOT EXISTS idx_files_identity ON files(stable_identity);
CREATE TABLE IF NOT EXISTS file_projects (file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(file_id, project_id));
CREATE INDEX IF NOT EXISTS idx_file_projects_project ON file_projects(project_id, file_id);
CREATE TABLE IF NOT EXISTS managed_folders (id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id), parent_id TEXT REFERENCES managed_folders(id) ON DELETE SET NULL, display_name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_managed_folders_sibling_name ON managed_folders(collection_id, parent_id, display_name);
CREATE TABLE IF NOT EXISTS library_file_metadata (file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, collection_id TEXT NOT NULL REFERENCES collections(id), origin TEXT NOT NULL CHECK(origin IN ('source','fixture','managed_upload','legacy_simulated')), content_key TEXT, managed_folder_id TEXT REFERENCES managed_folders(id) ON DELETE SET NULL, display_name TEXT NOT NULL, contributor_id TEXT, availability TEXT NOT NULL CHECK(availability IN ('available','unavailable','processing','error')), trashed_at TEXT, sample_owned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_library_collection ON library_file_metadata(collection_id, trashed_at);
CREATE TABLE IF NOT EXISTS demo_profiles (id TEXT PRIMARY KEY CHECK(id IN ('employee','manager','administration-staff','system-administrator')), display_name TEXT NOT NULL, is_system_administrator INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS collection_grants (profile_id TEXT NOT NULL REFERENCES demo_profiles(id) ON DELETE CASCADE, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, can_read INTEGER NOT NULL DEFAULT 0, can_contribute INTEGER NOT NULL DEFAULT 0, can_organize INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(profile_id, collection_id), CHECK(can_organize=0 OR can_contribute=1), CHECK(can_contribute=0 OR can_read=1));
CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES demo_profiles(id), collection_id TEXT REFERENCES collections(id), provider_version TEXT NOT NULL, intent TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','partial','failed','completed')), request_key TEXT, request_fingerprint TEXT, safe_error_code TEXT, started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL, sample_owned INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS agent_plans (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES demo_profiles(id), provider_version TEXT NOT NULL, operation_json TEXT NOT NULL, reason TEXT NOT NULL, target_fingerprint TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('ready','applied','stale')), expires_at TEXT NOT NULL, created_at TEXT NOT NULL, applied_run_id TEXT REFERENCES agent_runs(id));
CREATE INDEX IF NOT EXISTS idx_agent_plans_profile_created ON agent_plans(profile_id,created_at DESC);
CREATE TABLE IF NOT EXISTS agent_upload_operations (profile_id TEXT NOT NULL REFERENCES demo_profiles(id), operation_key TEXT NOT NULL, payload_fingerprint TEXT NOT NULL, file_id TEXT NOT NULL REFERENCES files(id), run_id TEXT REFERENCES agent_runs(id), step_key TEXT, created_at TEXT NOT NULL, PRIMARY KEY(profile_id,operation_key));
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_profile_request ON agent_runs(profile_id,request_key) WHERE request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_profile_created ON agent_runs(profile_id,created_at DESC);
CREATE TABLE IF NOT EXISTS agent_steps (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE, step_key TEXT NOT NULL, action_type TEXT NOT NULL, target_ids_json TEXT NOT NULL DEFAULT '[]', target_fingerprint TEXT, state TEXT NOT NULL CHECK(state IN ('planned','queued','running','succeeded','failed','skipped')), reason TEXT NOT NULL, result_json TEXT, idempotency_key TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(run_id,step_key));
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_steps_idempotency ON agent_steps(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS agent_summaries (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE, file_id TEXT NOT NULL REFERENCES files(id), source_fingerprint TEXT NOT NULL, source_file_updated_at TEXT NOT NULL DEFAULT '', source_metadata_updated_at TEXT NOT NULL DEFAULT '', extraction_method TEXT NOT NULL, excerpt_text TEXT NOT NULL, truncated INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(run_id,file_id,source_fingerprint));
CREATE INDEX IF NOT EXISTS idx_agent_summaries_file ON agent_summaries(file_id,created_at DESC);
CREATE TABLE IF NOT EXISTS collection_rules (id TEXT PRIMARY KEY, creator_profile_id TEXT NOT NULL REFERENCES demo_profiles(id), managing_profile_id TEXT REFERENCES demo_profiles(id), management_blocked INTEGER NOT NULL DEFAULT 0, recipient_profile_id TEXT NOT NULL REFERENCES demo_profiles(id), collection_id TEXT NOT NULL REFERENCES collections(id), project_id TEXT REFERENCES projects(id), managed_folder_id TEXT REFERENCES managed_folders(id) ON DELETE SET NULL, current_version INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, archived_at TEXT, paused_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sample_owned INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_collection_rules_recipient ON collection_rules(recipient_profile_id,collection_id,enabled,archived_at);
CREATE TABLE IF NOT EXISTS collection_rule_events (id TEXT PRIMARY KEY, rule_id TEXT NOT NULL REFERENCES collection_rules(id), actor_profile_id TEXT NOT NULL REFERENCES demo_profiles(id), event_type TEXT NOT NULL, version INTEGER NOT NULL, occurred_at TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS idx_collection_rule_events_rule_time ON collection_rule_events(rule_id,occurred_at,id);
CREATE TABLE IF NOT EXISTS collection_rule_versions (rule_id TEXT NOT NULL REFERENCES collection_rules(id) ON DELETE CASCADE, version INTEGER NOT NULL, definition_json TEXT NOT NULL, timezone TEXT NOT NULL, opening_cron TEXT, window_start TEXT, window_end TEXT, window_minutes INTEGER, created_by TEXT NOT NULL REFERENCES demo_profiles(id), created_at TEXT NOT NULL, PRIMARY KEY(rule_id,version));
CREATE TABLE IF NOT EXISTS collection_periods (id TEXT PRIMARY KEY, rule_id TEXT NOT NULL REFERENCES collection_rules(id), rule_version INTEGER NOT NULL, occurrence_key TEXT NOT NULL, recipient_profile_id TEXT NOT NULL REFERENCES demo_profiles(id), collection_id TEXT NOT NULL REFERENCES collections(id), opens_at TEXT NOT NULL, closes_at TEXT NOT NULL, timezone TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('upcoming','pending','partial','received','overdue','received_late','cancelled','not_evaluated')), evaluated_at TEXT, cancelled_at TEXT, cancellation_reason TEXT, superseded_at TEXT, created_at TEXT NOT NULL, UNIQUE(rule_id,occurrence_key), FOREIGN KEY(rule_id,rule_version) REFERENCES collection_rule_versions(rule_id,version));
CREATE INDEX IF NOT EXISTS idx_collection_periods_scope ON collection_periods(collection_id,recipient_profile_id,opens_at,closes_at);
CREATE INDEX IF NOT EXISTS idx_collection_periods_due ON collection_periods(status,closes_at);
CREATE TABLE IF NOT EXISTS collection_evidence (id TEXT PRIMARY KEY, period_id TEXT NOT NULL REFERENCES collection_periods(id), slot_key TEXT NOT NULL, file_id TEXT NOT NULL REFERENCES files(id), contributor_profile_id TEXT NOT NULL REFERENCES demo_profiles(id), uploaded_at TEXT NOT NULL, linked_at TEXT NOT NULL, linked_by TEXT NOT NULL REFERENCES demo_profiles(id), is_late INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, inactive_reason TEXT, UNIQUE(period_id,file_id));
CREATE INDEX IF NOT EXISTS idx_collection_evidence_slot ON collection_evidence(period_id,slot_key,active);
CREATE INDEX IF NOT EXISTS idx_collection_evidence_file ON collection_evidence(file_id,active);
CREATE TABLE IF NOT EXISTS collection_events (id TEXT PRIMARY KEY, period_id TEXT NOT NULL REFERENCES collection_periods(id), event_type TEXT NOT NULL, actor_profile_id TEXT REFERENCES demo_profiles(id), occurred_at TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS idx_collection_events_period_time ON collection_events(period_id,occurred_at,id);
CREATE TABLE IF NOT EXISTS agent_schedules (id TEXT PRIMARY KEY, owner_profile_id TEXT NOT NULL REFERENCES demo_profiles(id), managing_profile_id TEXT REFERENCES demo_profiles(id), management_blocked INTEGER NOT NULL DEFAULT 0, collection_id TEXT NOT NULL REFERENCES collections(id), rule_id TEXT REFERENCES collection_rules(id), action_type TEXT NOT NULL CHECK(action_type IN ('collection_check','collection_summary')), schedule_kind TEXT NOT NULL DEFAULT 'recurring' CHECK(schedule_kind IN ('once','recurring')), timezone TEXT NOT NULL, cron_expression TEXT NOT NULL DEFAULT '', run_at TEXT, next_run_at TEXT, paused_at TEXT, archived_at TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sample_owned INTEGER NOT NULL DEFAULT 0, CHECK((schedule_kind='once' AND run_at IS NOT NULL) OR (schedule_kind='recurring' AND cron_expression!='')));
CREATE INDEX IF NOT EXISTS idx_agent_schedules_due ON agent_schedules(paused_at,archived_at,next_run_at);
CREATE INDEX IF NOT EXISTS idx_agent_schedules_scope ON agent_schedules(owner_profile_id,collection_id);
CREATE TABLE IF NOT EXISTS scheduled_runs (id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL REFERENCES agent_schedules(id), occurrence_key TEXT NOT NULL, action_type TEXT NOT NULL CHECK(action_type IN ('collection_check','collection_summary','period_generation')), status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','skipped','blocked')), trigger_kind TEXT NOT NULL CHECK(trigger_kind IN ('scheduled','manual')), attempt_count INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL, lease_owner TEXT, lease_expires_at TEXT, result_json TEXT, safe_error_code TEXT, started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL, UNIQUE(schedule_id,occurrence_key));
CREATE TABLE IF NOT EXISTS agent_schedule_events (id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL REFERENCES agent_schedules(id), actor_profile_id TEXT NOT NULL REFERENCES demo_profiles(id), event_type TEXT NOT NULL, version INTEGER NOT NULL, occurred_at TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS idx_agent_schedule_events_scope ON agent_schedule_events(schedule_id,occurred_at,id);
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_claim ON scheduled_runs(status,available_at,lease_expires_at);
CREATE TABLE IF NOT EXISTS agent_notices (id TEXT PRIMARY KEY, period_id TEXT NOT NULL REFERENCES collection_periods(id), recipient_profile_id TEXT NOT NULL REFERENCES demo_profiles(id), notice_kind TEXT NOT NULL CHECK(notice_kind IN ('due_soon','overdue')), missing_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, dismissed_at TEXT, UNIQUE(period_id,recipient_profile_id,notice_kind));
CREATE INDEX IF NOT EXISTS idx_agent_notices_recipient ON agent_notices(recipient_profile_id,dismissed_at,created_at DESC);
CREATE TABLE IF NOT EXISTS worker_heartbeats (worker_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL, last_success_at TEXT, status TEXT NOT NULL CHECK(status IN ('running','stopped','error')), safe_error_code TEXT);
CREATE TABLE IF NOT EXISTS file_events (id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE, event_type TEXT NOT NULL, actor_id TEXT NOT NULL, occurred_at TEXT NOT NULL, before_json TEXT, after_json TEXT, agent_run_id TEXT, agent_step_key TEXT);
CREATE INDEX IF NOT EXISTS idx_file_events_file_time ON file_events(file_id, occurred_at, id);
CREATE TABLE IF NOT EXISTS file_relations (id INTEGER PRIMARY KEY AUTOINCREMENT, from_file_id TEXT NOT NULL REFERENCES files(id), to_file_id TEXT NOT NULL REFERENCES files(id), relation TEXT NOT NULL, UNIQUE(from_file_id, to_file_id, relation));
CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, file_id TEXT NOT NULL REFERENCES files(id), reviewer TEXT NOT NULL, decision TEXT NOT NULL, reason TEXT, reviewed_at TEXT NOT NULL, classification_snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS findings (id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id), type TEXT NOT NULL, reason TEXT NOT NULL, evidence TEXT NOT NULL, confidence REAL NOT NULL, state TEXT NOT NULL DEFAULT 'open', reviewed_at TEXT, review_note TEXT, demo_owned INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS index_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT, source_root TEXT NOT NULL, indexed_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, last_error TEXT);
CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, entity_id TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS review_items (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), file_id TEXT NOT NULL REFERENCES files(id), target_kind TEXT NOT NULL, target_id TEXT NOT NULL, state TEXT NOT NULL, severity TEXT NOT NULL, priority TEXT NOT NULL, assignee_id TEXT, assignee_name TEXT, assignee_role TEXT, due_at TEXT NOT NULL, escalation_reason TEXT, completed_at TEXT, final_outcome TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, demo_owned INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_review_items_queue ON review_items(state, due_at, priority);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_items_open_target ON review_items(target_kind, target_id) WHERE state != 'completed';
CREATE TABLE IF NOT EXISTS decision_events (id TEXT PRIMARY KEY, review_item_id TEXT REFERENCES review_items(id), file_id TEXT REFERENCES files(id), entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, event_type TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, actor_role TEXT, occurred_at TEXT NOT NULL, context_json TEXT NOT NULL, demo_owned INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_decision_events_entity ON decision_events(entity_type, entity_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_decision_events_review_item ON decision_events(review_item_id, occurred_at);
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(file_id UNINDEXED, filename, source_path, project_name, document_type, metadata_text);
`;

function migrate(db: SqliteDatabase) {
  for (const statement of [
    "ALTER TABLE projects ADD COLUMN demo_owned INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE files ADD COLUMN demo_owned INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE files ADD COLUMN preview_kind TEXT",
    "ALTER TABLE files ADD COLUMN preview_title TEXT",
    "ALTER TABLE files ADD COLUMN preview_url TEXT",
    "ALTER TABLE files ADD COLUMN preview_content TEXT",
    "ALTER TABLE files ADD COLUMN preview_sections TEXT",
  ]) {
    try {
      db.exec(statement);
    } catch {
      /* existing column */
    }
  }
  const existingFileColumns = new Set(
    (db.prepare("PRAGMA table_info(files)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  for (const column of ["category_id", "discipline_tag", "location_tag"] as const) {
    if (!existingFileColumns.has(column))
      db.exec(`ALTER TABLE files ADD COLUMN ${column} TEXT`);
  }
  const existingCollectionColumns = new Set(
    (db.prepare("PRAGMA table_info(collections)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  const existingScheduleColumns = new Set(
    (db.prepare("PRAGMA table_info(agent_schedules)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  const existingRuleColumns = new Set(
    (db.prepare("PRAGMA table_info(collection_rules)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  const existingPeriodColumns = new Set(
    (db.prepare("PRAGMA table_info(collection_periods)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  const existingFileEventColumns = new Set(
    (db.prepare("PRAGMA table_info(file_events)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  const existingSummaryColumns = new Set(
    (db.prepare("PRAGMA table_info(agent_summaries)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  for (const column of ["source_file_updated_at", "source_metadata_updated_at"] as const) {
    if (!existingSummaryColumns.has(column)) db.exec(`ALTER TABLE agent_summaries ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
  }
  for (const column of ["agent_run_id", "agent_step_key"] as const) {
    if (!existingFileEventColumns.has(column)) db.exec(`ALTER TABLE file_events ADD COLUMN ${column} TEXT`);
  }
  if (!existingPeriodColumns.has("superseded_at"))
    db.exec("ALTER TABLE collection_periods ADD COLUMN superseded_at TEXT");
  for (const [column, definition] of [
    ["schedule_kind", "TEXT NOT NULL DEFAULT 'recurring'"],
    ["run_at", "TEXT"],
    ["archived_at", "TEXT"],
  ] as const) {
    if (!existingScheduleColumns.has(column))
      db.exec(`ALTER TABLE agent_schedules ADD COLUMN ${column} ${definition}`);
  }
  for (const [column, definition] of [["managing_profile_id", "TEXT REFERENCES demo_profiles(id)"], ["management_blocked", "INTEGER NOT NULL DEFAULT 0"]] as const) {
    if (!existingRuleColumns.has(column)) db.exec(`ALTER TABLE collection_rules ADD COLUMN ${column} ${definition}`);
  }
  for (const [column, definition] of [["managing_profile_id", "TEXT REFERENCES demo_profiles(id)"], ["management_blocked", "INTEGER NOT NULL DEFAULT 0"]] as const) {
    if (!existingScheduleColumns.has(column)) db.exec(`ALTER TABLE agent_schedules ADD COLUMN ${column} ${definition}`);
  }
  db.exec(`
    UPDATE collection_rules SET managing_profile_id='system-administrator' WHERE managing_profile_id IS NULL AND creator_profile_id='system-administrator';
    UPDATE collection_rules SET management_blocked=1 WHERE managing_profile_id IS NULL AND creator_profile_id!='system-administrator';
    UPDATE agent_schedules SET managing_profile_id='system-administrator' WHERE managing_profile_id IS NULL AND owner_profile_id='system-administrator';
    UPDATE agent_schedules SET management_blocked=1,paused_at=COALESCE(paused_at,updated_at),version=version+1 WHERE managing_profile_id IS NULL AND owner_profile_id!='system-administrator' AND management_blocked=0;
  `);
  for (const column of ["project_id", "sample_owned"] as const) {
    if (!existingCollectionColumns.has(column)) {
      const clause =
        column === "project_id"
          ? "TEXT REFERENCES projects(id)"
          : "INTEGER NOT NULL DEFAULT 0";
      db.exec(`ALTER TABLE collections ADD COLUMN ${column} ${clause}`);
    }
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_project_id ON collections(project_id)",
  );
  const projectId = (
    db.prepare("PRAGMA table_info(files)").all() as Array<{
      name: string;
      notnull: number;
    }>
  ).find((column) => column.name === "project_id");
  if (projectId?.notnull) {
    db.exec("PRAGMA foreign_keys=OFF");
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(`CREATE TABLE files_library_new (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id),
        stable_identity TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        source_path TEXT NOT NULL,
        extension TEXT NOT NULL DEFAULT '',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        modified_at TEXT NOT NULL,
        document_type TEXT NOT NULL DEFAULT 'other',
        status TEXT NOT NULL,
        index_state TEXT NOT NULL DEFAULT 'indexed',
        metadata_text TEXT NOT NULL DEFAULT '',
        reviewer TEXT,
        reviewed_at TEXT,
        review_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        demo_owned INTEGER NOT NULL DEFAULT 0,
        preview_kind TEXT,
        preview_title TEXT,
        preview_url TEXT,
        preview_content TEXT,
        preview_sections TEXT,
        category_id TEXT,
        discipline_tag TEXT,
        location_tag TEXT
      )`);
      db.exec(`INSERT INTO files_library_new (
        id,project_id,stable_identity,filename,source_path,extension,size_bytes,
        modified_at,document_type,status,index_state,metadata_text,reviewer,
        reviewed_at,review_reason,created_at,updated_at,demo_owned,preview_kind,
        preview_title,preview_url,preview_content,preview_sections,category_id,
        discipline_tag,location_tag
      ) SELECT
        id,project_id,stable_identity,filename,source_path,extension,size_bytes,
        modified_at,document_type,status,index_state,metadata_text,reviewer,
        reviewed_at,review_reason,created_at,updated_at,demo_owned,preview_kind,
        preview_title,preview_url,preview_content,preview_sections,category_id,
        discipline_tag,location_tag
      FROM files`);
      db.exec("DROP TABLE files; ALTER TABLE files_library_new RENAME TO files");
      db.exec("CREATE INDEX idx_files_project_status ON files(project_id,status)");
      db.exec("CREATE INDEX idx_files_identity ON files(stable_identity)");
      if (db.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error("File-library migration produced foreign-key violations");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      db.exec("PRAGMA foreign_keys=ON");
    }
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length)
      throw new Error("File-library migration produced foreign-key violations");
  }
}

export function openDatabase(
  databasePath = getConfig().databasePath,
): SqliteDatabase {
  if (cached && cachedPath === databasePath && cached.isOpen) return cached;
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  if (databasePath === getConfig().databasePath) { cached = db; cachedPath = databasePath; }
  return db;
}

function now() {
  return new Date().toISOString();
}
function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}
function ingestionStatusFor(status: FileStatus): FileStatus {
  return status === "missing_metadata" || status === "pending_ingestion"
    ? status
    : "pending_review";
}
function previewValues(preview: PreviewDescriptor) {
  return {
    previewKind: preview.kind,
    previewTitle: preview.title,
    previewUrl: preview.url ?? null,
    previewContent: preview.content ?? preview.reason ?? null,
    previewSections: preview.sections ? JSON.stringify(preview.sections) : null,
  };
}

function initializeLibraryModel(db: SqliteDatabase): void {
  const timestamp = now();
  const insertCollection = db.prepare(`
    INSERT INTO collections (id,name,kind,project_id,sample_owned,created_at,updated_at)
    VALUES (@id,@name,@kind,@projectId,@sampleOwned,@createdAt,@updatedAt)
    ON CONFLICT(id) DO UPDATE SET project_id=COALESCE(collections.project_id,excluded.project_id)
  `);
  const projects = db.prepare("SELECT id,slug,name,demo_owned FROM projects ORDER BY slug").all() as Array<{
    id: string; slug: string; name: string; demo_owned: number;
  }>;
  for (const project of projects) {
    insertCollection.run({
      id: `collection-project-${project.id}`,
      name: project.name,
      kind: "project",
      projectId: project.id,
      sampleOwned: project.demo_owned,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  for (const collection of [
    { id: "collection-shared-resources", name: "Recursos compartidos", kind: "shared" },
    { id: "collection-administration", name: "Administración", kind: "administration" },
  ] as const) {
    insertCollection.run({
      ...collection,
      projectId: null,
      sampleOwned: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  db.exec(`
    INSERT OR IGNORE INTO demo_profiles (id,display_name,is_system_administrator) VALUES
      ('employee','Empleado',0),
      ('manager','Gerencia',0),
      ('administration-staff','Administración',0),
      ('system-administrator','Administrador del sistema',1)
  `);
  const grants = db.prepare(`
    INSERT OR IGNORE INTO collection_grants
      (profile_id,collection_id,can_read,can_contribute,can_organize)
    VALUES (?,?,?,?,?)
  `);
  const collectionRows = db.prepare("SELECT id,kind,project_id FROM collections").all() as Array<{
    id: string; kind: "project" | "shared" | "administration"; project_id: string | null;
  }>;
  const projectSlugById = new Map(projects.map((project) => [project.id, project.slug]));
  for (const collection of collectionRows) {
    const slug = collection.project_id ? projectSlugById.get(collection.project_id) : undefined;
    const preset: Record<string, readonly [number, number, number]> = {
      employee:
        collection.kind === "shared" || slug === "costa-norte" ? [1, slug === "costa-norte" ? 1 : 0, 0] : [0, 0, 0],
      manager:
        collection.kind === "shared" ? [1, 0, 0] : slug === "costa-norte" || slug === "parque-industrial" ? [1, 1, 1] : slug === "torre-del-parque" || slug === "torre-horizonte" ? [1, 0, 0] : [0, 0, 0],
      "administration-staff":
        collection.kind === "shared" ? [1, 1, 0] : collection.kind === "administration" ? [1, 1, 1] : [0, 0, 0],
      "system-administrator": [1, 1, 1],
    };
    for (const profileId of Object.keys(preset))
      grants.run(profileId, collection.id, ...preset[profileId]);
  }

  db.prepare(`
    INSERT OR IGNORE INTO file_projects (file_id,project_id,created_at)
    SELECT id,project_id,created_at FROM files WHERE project_id IS NOT NULL
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO library_file_metadata
      (file_id,collection_id,origin,content_key,managed_folder_id,display_name,
       contributor_id,availability,trashed_at,sample_owned,created_at,updated_at)
    SELECT f.id,c.id,
      CASE WHEN f.source_path LIKE 'simulated://%' THEN 'legacy_simulated'
           WHEN f.demo_owned=1 THEN 'fixture' ELSE 'source' END,
      NULL,NULL,f.filename,NULL,
      CASE WHEN f.source_path LIKE 'simulated://%' OR f.preview_kind='unavailable'
           THEN 'unavailable' ELSE 'available' END,
      NULL,
      CASE WHEN f.demo_owned=1 AND f.source_path NOT LIKE 'simulated://%' THEN 1 ELSE 0 END,
      f.created_at,f.updated_at
    FROM files f
    JOIN projects p ON p.id=f.project_id
    JOIN collections c ON c.project_id=p.id
  `).run();
}

export function resetDemoFixtures(db = openDatabase()): void {
  initializeLibraryModel(db);
  const placeholders = DEMO_SLUGS.map(() => "?").join(",");
  const projectRows = db
    .prepare(
      `SELECT id FROM projects WHERE demo_owned=1 OR slug IN (${placeholders})`,
    )
    .all(...DEMO_SLUGS) as Array<{ id: string }>;
  const projectIds = projectRows.map((row) => row.id);
  const fileIds = projectIds.length
    ? (
        db
          .prepare(
            `SELECT f.id
             FROM files f
             LEFT JOIN library_file_metadata m ON m.file_id=f.id
             WHERE f.demo_owned=1
               AND f.project_id IN (${projectIds.map(() => "?").join(",")})
               AND (m.sample_owned=1 OR f.source_path LIKE 'simulated://%')`,
          )
          .all(...projectIds) as Array<{ id: string }>
      ).map((row) => row.id)
    : [];
  db.exec("BEGIN");
  try {
    if (fileIds.length) {
      const marks = fileIds.map(() => "?").join(",");
      const reviewRows = db
        .prepare(
          `SELECT id FROM review_items WHERE demo_owned=1 AND (file_id IN (${marks}) OR project_id IN (${projectIds.map(() => "?").join(",")}))`,
        )
        .all(...fileIds, ...projectIds) as Array<{ id: string }>;
      const reviewIds = reviewRows.map((row) => row.id);
      const eventReviewClause = reviewIds.length
        ? ` OR review_item_id IN (${reviewIds.map(() => "?").join(",")})`
        : "";
      db.prepare(
        `DELETE FROM decision_events WHERE demo_owned=1 AND (file_id IN (${marks})${eventReviewClause})`,
      ).run(...fileIds, ...reviewIds);
      if (reviewIds.length)
        db.prepare(
          `DELETE FROM decision_events WHERE review_item_id IN (${reviewIds.map(() => "?").join(",")})`,
        ).run(...reviewIds);
      db.prepare(
        `DELETE FROM review_items WHERE demo_owned=1 AND (file_id IN (${marks}) OR project_id IN (${projectIds.map(() => "?").join(",")}))`,
      ).run(...fileIds, ...projectIds);
      db.prepare(
        `DELETE FROM findings WHERE demo_owned=1 AND file_id IN (${marks})`,
      ).run(...fileIds);
      db.prepare(`DELETE FROM reviews WHERE file_id IN (${marks})`).run(
        ...fileIds,
      );
      db.prepare(
        `DELETE FROM file_relations WHERE from_file_id IN (${marks}) OR to_file_id IN (${marks})`,
      ).run(...fileIds, ...fileIds);
      db.prepare(`DELETE FROM files WHERE id IN (${marks})`).run(...fileIds);
    } else {
      db.prepare("DELETE FROM decision_events WHERE demo_owned=1").run();
      db.prepare("DELETE FROM review_items WHERE demo_owned=1").run();
      db.prepare("DELETE FROM findings WHERE demo_owned=1").run();
    }
    if (projectIds.length) {
      db.prepare(
        `DELETE FROM collections
         WHERE project_id IN (${projectIds.map(() => "?").join(",")})
           AND NOT EXISTS (
             SELECT 1 FROM library_file_metadata
             WHERE library_file_metadata.collection_id=collections.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM managed_folders
             WHERE managed_folders.collection_id=collections.id
           )`,
      ).run(...projectIds);
      db.prepare(
        `DELETE FROM projects WHERE id IN (${projectIds.map(() => "?").join(",")}) AND NOT EXISTS (SELECT 1 FROM files WHERE files.project_id=projects.id) AND NOT EXISTS (SELECT 1 FROM review_items WHERE review_items.project_id=projects.id) AND NOT EXISTS (SELECT 1 FROM collections WHERE collections.project_id=projects.id) AND NOT EXISTS (SELECT 1 FROM file_projects WHERE file_projects.project_id=projects.id)`,
      ).run(...projectIds);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const timestamp = "2026-10-07T12:00:00.000Z";
  const insertProject = db.prepare(
    "INSERT INTO projects (id,slug,name,source_root,created_at,updated_at,demo_owned) VALUES (@id,@slug,@name,@sourceRoot,@createdAt,@updatedAt,1) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,name=excluded.name,source_root=excluded.source_root,updated_at=excluded.updated_at,demo_owned=1",
  );
  const insertFile = db.prepare(
    "INSERT INTO files (id,project_id,stable_identity,filename,source_path,extension,size_bytes,modified_at,document_type,status,index_state,metadata_text,created_at,updated_at,demo_owned,preview_kind,preview_title,preview_url,preview_content,preview_sections,category_id,discipline_tag,location_tag) VALUES (@id,@projectId,@stableIdentity,@filename,@sourcePath,@extension,@sizeBytes,@modifiedAt,@documentType,@status,'indexed',@metadataText,@createdAt,@updatedAt,1,@previewKind,@previewTitle,@previewUrl,@previewContent,@previewSections,@categoryId,@disciplineTag,@locationTag)",
  );
  const insertRelation = db.prepare(
    "INSERT INTO file_relations (from_file_id,to_file_id,relation) VALUES (?,?,?)",
  );
  const insertFinding = db.prepare(
    "INSERT INTO findings (id,file_id,type,reason,evidence,confidence,state,demo_owned) VALUES (@id,@fileId,@type,@reason,@evidence,@confidence,'open',1)",
  );
  const insertBaseline = db.prepare(
    "INSERT INTO decision_events (id,review_item_id,file_id,entity_type,entity_id,event_type,actor_id,actor_name,actor_role,occurred_at,context_json,demo_owned) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)",
  );
  for (const scenario of scenarioRegistry) {
    const project: Project = {
      id: `project-${scenario.slug}`,
      slug: scenario.slug,
      name: scenario.name,
      sourceRoot: scenario.sourceRoot,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    insertProject.run({
      ...project,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    for (const file of scenario.files) {
      const { preview, tags, ...fileValues } = file;
      insertFile.run({
        ...fileValues,
        projectId: project.id,
        stableIdentity: `demo:${scenario.slug}:${file.id}`,
        createdAt: timestamp,
        updatedAt: timestamp,
        disciplineTag: tags.discipline,
        locationTag: tags.location,
        ...previewValues(preview),
      });
      insertBaseline.run(
        `event-${file.id}-indexed`,
        null,
        file.id,
        "file_classification",
        file.id,
        "indexed",
        "system",
        "System",
        null,
        file.modifiedAt,
        JSON.stringify({
          after: { fileStatus: ingestionStatusFor(file.status) },
        }),
      );
    }
    for (const relation of scenario.relations)
      insertRelation.run(relation.from, relation.to, relation.type);
    for (const finding of scenario.findings) insertFinding.run({ ...finding });
  }
  const createItem = db.prepare(
    "INSERT INTO review_items (id,project_id,file_id,target_kind,target_id,state,severity,priority,assignee_id,assignee_name,assignee_role,due_at,created_at,updated_at,demo_owned) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
  );
  const createEvent = db.prepare(
    "INSERT INTO decision_events (id,review_item_id,file_id,entity_type,entity_id,event_type,actor_id,actor_name,actor_role,occurred_at,context_json,demo_owned) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)",
  );
  const seed = (
    id: string,
    projectId: string,
    fileId: string,
    kind: string,
    targetId: string,
    severity: string,
    assignee: string | null,
    role: string | null,
  ) => {
    const due = id.includes("parque-duplicate")
      ? "2026-10-07T12:00:00.000Z"
      : "2026-10-09T12:00:00.000Z";
    const state = assignee ? "assigned" : "unassigned";
    createItem.run(
      id,
      projectId,
      fileId,
      kind,
      targetId,
      state,
      severity,
      severity,
      assignee,
      assignee ? assignee.replace("-", " ") : null,
      role,
      due,
      timestamp,
      timestamp,
    );
    createEvent.run(
      `event-${id}`,
      id,
      fileId,
      "review_item",
      id,
      "review_created",
      "system",
      "System",
      null,
      timestamp,
      JSON.stringify({ targetKind: kind, targetId, severity, dueAt: due }),
    );
  };
  seed(
    "review-costa-notice",
    "project-costa-norte",
    "costa-notice",
    "file_classification",
    "costa-notice",
    "high",
    "document-controller",
    "Document controller",
  );
  seed(
    "review-parque-duplicate-a",
    "project-parque-industrial",
    "parque-duplicate-a",
    "file_classification",
    "parque-duplicate-a",
    "high",
    null,
    null,
  );
  seed(
    "review-parque-duplicate-b",
    "project-parque-industrial",
    "parque-duplicate-b",
    "file_classification",
    "parque-duplicate-b",
    "high",
    null,
    null,
  );
  seed(
    "review-torre-spec",
    "project-torre-del-parque",
    "torre-especificacion",
    "file_classification",
    "torre-especificacion",
    "normal",
    "technical-lead",
    "Technical lead",
  );
  for (const finding of scenarioRegistry.flatMap(
    (scenario) => scenario.findings,
  )) {
    const file = scenarioRegistry
      .flatMap((scenario) => scenario.files)
      .find((item) => item.id === finding.fileId)!;
    const project = scenarioRegistry.find((scenario) =>
      scenario.files.some((item) => item.id === file.id),
    )!;
    seed(
      `review-${finding.id}`,
      `project-${project.slug}`,
      file.id,
      "finding",
      finding.id,
      finding.type === "possible_duplicate" ? "high" : "normal",
      null,
      null,
    );
  }
  const approvalSeeds = [
    {
      fileId: "costa-plan-current",
      reviewer: "Technical lead",
      reviewedAt: "2026-10-05T09:30:00.000Z",
      reason:
        "Aprobación técnica de jefatura de obra. Revisión C vigente para ejecución.",
      actorId: "technical-lead",
      actorName: "Technical lead",
      actorRole: "Technical lead",
    },
    {
      fileId: "costa-plan-old",
      reviewer: "Technical lead",
      reviewedAt: "2026-08-14T14:00:00.000Z",
      reason: "Aprobación técnica de la Revisión B para obra.",
      actorId: "technical-lead",
      actorName: "Technical lead",
      actorRole: "Technical lead",
    },
    {
      fileId: "torre-fachada",
      reviewer: "Technical lead",
      reviewedAt: "2026-10-01T09:00:00.000Z",
      reason: "Fachada principal aprobada para obra.",
      actorId: "technical-lead",
      actorName: "Technical lead",
      actorRole: "Technical lead",
    },
    {
      fileId: "parque-contract",
      reviewer: "Document controller",
      reviewedAt: "2026-08-11T14:00:00.000Z",
      reason: "Contrato registrado y verificado.",
      actorId: "document-controller",
      actorName: "Document controller",
      actorRole: "Document controller",
    },
  ];
  const setApproval = db.prepare(
    "UPDATE files SET reviewer=?,reviewed_at=?,review_reason=? WHERE id=?",
  );
  const insertDecision = db.prepare(
    "INSERT INTO decision_events (id,review_item_id,file_id,entity_type,entity_id,event_type,actor_id,actor_name,actor_role,occurred_at,context_json,demo_owned) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)",
  );
  for (const scenario of scenarioRegistry) {
    for (const file of scenario.files) {
      if (file.status !== "approved" && file.status !== "superseded") continue;
      const approval = approvalSeeds.find((seed) => seed.fileId === file.id);
      const reviewer = approval?.reviewer ?? "Technical lead";
      const reviewedAt = approval?.reviewedAt ?? addHours(file.modifiedAt, 1);
      const reason =
        approval?.reason ?? "Aprobación técnica registrada para la demo.";
      const actorId = approval?.actorId ?? "technical-lead";
      const actorName = approval?.actorName ?? "Technical lead";
      const actorRole = approval?.actorRole ?? "Technical lead";
      setApproval.run(reviewer, reviewedAt, reason, file.id);
      insertDecision.run(
        `event-${file.id}-approve`,
        null,
        file.id,
        "file_classification",
        file.id,
        "approve",
        actorId,
        actorName,
        actorRole,
        reviewedAt,
        JSON.stringify({
          reason,
          before: { fileStatus: "pending_review" },
          after: { fileStatus: "approved" },
        }),
      );
    }
  }
  insertDecision.run(
    "event-costa-plan-old-superseded",
    null,
    "costa-plan-old",
    "file_classification",
    "costa-plan-old",
    "superseded",
    "technical-lead",
    "Technical lead",
    "Technical lead",
    "2026-10-05T09:30:00.000Z",
    JSON.stringify({
      reason: "Reemplazado por Plano general Rev C.",
      replacedBy: "costa-plan-current",
      after: { fileStatus: "superseded" },
    }),
  );
  rebuildSearchIndex(db);
  db.prepare(
    "INSERT INTO index_runs (started_at,finished_at,source_root,indexed_count,error_count,status) VALUES (?,?,?,?,?,?)",
  ).run(
    timestamp,
    timestamp,
    "demo-fixtures",
    scenarioRegistry.reduce(
      (count, scenario) => count + scenario.files.length,
      0,
    ),
    0,
    "success",
  );
  initializeLibraryModel(db);
}

export function seedFixtures(db = openDatabase()): void {
  const count = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM projects WHERE demo_owned=1 AND slug IN (${DEMO_SLUGS.map(() => "?").join(",")})`,
        )
        .get(...DEMO_SLUGS) as { count: number }
    ).count,
  );
  const governedCount = Number(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM review_items WHERE demo_owned=1",
        )
        .get() as { count: number }
    ).count,
  );
  const approvalCount = Number(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM decision_events WHERE event_type='approve' AND actor_id != 'system'",
        )
        .get() as { count: number }
    ).count,
  );
  const previewContract = db
    .prepare("SELECT preview_kind AS kind FROM files WHERE id='costa-photo'")
    .get() as { kind?: string } | undefined;
  const docxPreviewContract = db
    .prepare(
      "SELECT preview_kind AS kind, preview_content AS content FROM files WHERE id='costa-notice'",
    )
    .get() as { kind?: string; content?: string } | undefined;
  if (
    count !== scenarioRegistry.length ||
    governedCount === 0 ||
    approvalCount === 0 ||
    previewContract?.kind !== "image" ||
    docxPreviewContract?.kind !== "docx" ||
    !docxPreviewContract.content?.includes("canaleta técnica")
  )
    resetDemoFixtures(db);
  initializeLibraryModel(db);
  const backfillOrganization = db.prepare(
    "UPDATE files SET category_id=COALESCE(category_id,@categoryId),discipline_tag=COALESCE(discipline_tag,@disciplineTag),location_tag=COALESCE(location_tag,@locationTag) WHERE id=@id AND demo_owned=1 AND NOT EXISTS (SELECT 1 FROM file_events e WHERE e.file_id=files.id AND e.event_type='metadata_changed') AND (category_id IS NULL OR discipline_tag IS NULL OR location_tag IS NULL)",
  );
  for (const scenario of scenarioRegistry)
    for (const file of scenario.files)
      backfillOrganization.run({
        id: file.id,
        categoryId: file.categoryId,
        disciplineTag: file.tags.discipline,
        locationTag: file.tags.location,
      });
}
export function rebuildSearchIndex(db = openDatabase()): void {
  db.exec("DELETE FROM files_fts");
  db.prepare(
    "INSERT INTO files_fts (file_id,filename,source_path,project_name,document_type,metadata_text) SELECT files.id,COALESCE(m.display_name,files.filename),files.source_path,COALESCE(projects.name,''),files.document_type,files.metadata_text FROM files LEFT JOIN projects ON projects.id=files.project_id LEFT JOIN library_file_metadata m ON m.file_id=files.id",
  ).run();
}
function parsePreview(row: any): PreviewDescriptor | null {
  if (!row.preview_kind) return null;
  return {
    kind: row.preview_kind,
    title: row.preview_title ?? "Vista de archivo",
    url: row.preview_url ?? undefined,
    content: row.preview_content ?? undefined,
    sections: row.preview_sections
      ? JSON.parse(row.preview_sections)
      : undefined,
    reason:
      row.preview_kind === "docx" || row.preview_kind === "unavailable"
        ? (row.preview_content ?? undefined)
        : undefined,
  };
}

function inferPreview(row: any): PreviewDescriptor | null {
  const extension = String(row.extension ?? "")
    .replace(/^\./, "")
    .toLowerCase();
  const kind =
    extension === "pdf"
      ? "pdf"
      : extension === "docx"
        ? "docx"
        : extension === "md" || extension === "markdown" || extension === "txt"
          ? "markdown"
          : ["avif", "gif", "jpeg", "jpg", "png", "svg", "webp"].includes(
                extension,
              )
            ? "image"
            : null;
  return kind ? { kind, title: row.filename } : null;
}

function mapFile(row: any): DocumentFile {
  return {
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    sourcePath: row.source_path,
    extension: row.extension,
    sizeBytes: row.size_bytes,
    modifiedAt: row.modified_at,
    documentType: row.document_type,
    categoryId: row.category_id ?? null,
    tags: {
      discipline: row.discipline_tag ?? null,
      location: row.location_tag ?? null,
    },
    status: row.status,
    indexState: row.index_state,
    metadataText: row.metadata_text,
    reviewer: row.reviewer ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewReason: row.review_reason ?? null,
    relation: row.relation ?? null,
    preview: parsePreview(row) ?? inferPreview(row),
    demoOwned: Boolean(row.demo_owned),
  };
}
const fileQuery =
  "SELECT files.*, (SELECT relation FROM file_relations r WHERE r.from_file_id=files.id OR r.to_file_id=files.id LIMIT 1) AS relation FROM files";
export function listProjects(db = openDatabase()): Project[] {
  return db
    .prepare(
      "SELECT id,slug,name,source_root AS sourceRoot,created_at AS createdAt,updated_at AS updatedAt FROM projects ORDER BY name",
    )
    .all() as unknown as Project[];
}
export function getProject(
  slugOrId: string,
  db = openDatabase(),
): Project | null {
  return (
    (db
      .prepare(
        "SELECT id,slug,name,source_root AS sourceRoot,created_at AS createdAt,updated_at AS updatedAt FROM projects WHERE slug=? OR id=?",
      )
      .get(slugOrId, slugOrId) as Project | undefined) ?? null
  );
}

export function getPublicFile(
  fileId: string,
  db = openDatabase(),
): PublicFile | null {
  const row = db.prepare(`${fileQuery} WHERE files.id=?`).get(fileId);
  if (!row) return null;
  const file = mapFile(row);
  const library = db.prepare(
    "SELECT collection_id,origin,display_name,availability FROM library_file_metadata WHERE file_id=?",
  ).get(fileId) as {
    collection_id: string;
    origin: PublicFile["origin"];
    display_name: string;
    availability: PublicFile["availability"];
  } | undefined;
  if (!library) return null;
  const projects = db.prepare(
    "SELECT file_id AS fileId,project_id AS projectId,created_at AS createdAt FROM file_projects WHERE file_id=? ORDER BY project_id",
  ).all(fileId) as unknown as PublicFile["projects"];
  const versions = db.prepare(
    "SELECT from_file_id,to_file_id FROM file_relations WHERE relation='supersedes' AND (from_file_id=? OR to_file_id=?)",
  ).all(fileId, fileId) as Array<{ from_file_id: string; to_file_id: string }>;
  return {
    id: file.id,
    primaryProjectId: file.projectId,
    projects,
    filename: file.filename,
    displayName: library.display_name,
    extension: file.extension,
    sizeBytes: file.sizeBytes,
    modifiedAt: file.modifiedAt,
    documentType: file.documentType,
    organization: {
      categoryId: file.categoryId,
      tags: file.tags,
    },
    origin: library.origin,
    availability: library.availability,
    versions: {
      supersedes: versions
        .filter((version) => version.from_file_id === fileId)
        .map((version) => version.to_file_id),
      supersededBy: versions
        .filter((version) => version.to_file_id === fileId)
        .map((version) => version.from_file_id),
    },
    preview: file.preview,
  };
}
export function listProjectFiles(
  projectId: string,
  db = openDatabase(),
): DocumentFile[] {
  return (
    db
      .prepare(
        `${fileQuery} WHERE project_id=? ORDER BY document_type, status, modified_at DESC`,
      )
      .all(projectId) as any[]
  ).map(mapFile);
}
export function getFile(
  fileId: string,
  db = openDatabase(),
): DocumentFile | null {
  const row = db.prepare(`${fileQuery} WHERE files.id=?`).get(fileId);
  return row ? mapFile(row) : null;
}
export function getHealth(db = openDatabase()): IndexHealth {
  const row = db
    .prepare(
      "SELECT status,finished_at,indexed_count,error_count,last_error FROM index_runs ORDER BY id DESC LIMIT 1",
    )
    .get() as any;
  return row
    ? {
        status: row.status,
        finishedAt: row.finished_at,
        indexedCount: row.indexed_count,
        errorCount: row.error_count,
        lastError: row.last_error,
      }
    : {
        status: "unavailable",
        finishedAt: null,
        indexedCount: 0,
        errorCount: 0,
        lastError: "No index run has completed.",
      };
}

function searchWhere(
  filters: SearchFilters,
  projectId?: string,
  allowedFileIds?: readonly string[],
) {
  const conditions = ["1=1"];
  const condParams: Array<string> = [];
  if (projectId) {
    conditions.push("files.project_id=?");
    condParams.push(projectId);
  }
  if (allowedFileIds) {
    if (!allowedFileIds.length) conditions.push("0=1");
    else {
      conditions.push(`files.id IN (${allowedFileIds.map(() => "?").join(",")})`);
      condParams.push(...allowedFileIds);
    }
  }
  if (filters.status) {
    conditions.push("files.status=?");
    condParams.push(filters.status);
  }
  if (filters.type) {
    conditions.push("files.document_type=?");
    condParams.push(filters.type);
  }
  if (filters.category === "unclassified") conditions.push("files.category_id IS NULL");
  else if (filters.category) {
    conditions.push("files.category_id=?");
    condParams.push(filters.category);
  }
  if (filters.discipline) {
    conditions.push("files.discipline_tag=?");
    condParams.push(filters.discipline);
  }
  if (filters.location) {
    conditions.push("files.location_tag=?");
    condParams.push(filters.location);
  }
  if (filters.timeframe) {
    const days = filters.timeframe === "year" ? 365 : Number.parseInt(filters.timeframe, 10);
    conditions.push("files.modified_at>=?");
    condParams.push(new Date(Date.now() - days * 86_400_000).toISOString());
  }

  const searchParams: Array<string> = [];
  let matchSql = "1=1";
  if (filters.query) {
    const words = filters.query.split(/\s+/).filter(Boolean);
    const wordClauses = words.map(() => {
      return `(${["filename", "source_path", "metadata_text", "document_type"].map((field) => `${field} LIKE ?`).join(" OR ")})`;
    });
    matchSql = wordClauses.join(" AND ");
    for (const word of words) {
      searchParams.push(...Array(4).fill(`%${word}%`));
    }
  }
  return {
    where: `${matchSql} AND ${conditions.join(" AND ")}`,
    params: [...searchParams, ...condParams],
  };
}

export function searchFiles(
  filters: SearchFilters,
  projectId?: string,
  db = openDatabase(),
  allowedFileIds?: readonly string[],
): SearchResult[] {
  const { where, params } = searchWhere(filters, projectId, allowedFileIds);
  const orderBy = filters.sort === "name"
    ? "files.filename COLLATE NOCASE ASC"
    : filters.sort === "oldest"
      ? "files.modified_at ASC"
      : "files.modified_at DESC";
  const querySql = `SELECT files.*,(SELECT relation FROM file_relations r WHERE r.from_file_id=files.id OR r.to_file_id=files.id LIMIT 1) AS relation,projects.name AS project_name,projects.slug AS project_slug,0 AS rank FROM files JOIN projects ON projects.id=files.project_id WHERE ${where} ORDER BY ${orderBy} LIMIT 50`;

  const rows = db
    .prepare(querySql)
    .all(...params) as any[];
  return rows.map((row) => ({
    ...mapFile(row),
    projectName: row.project_name,
    projectSlug: row.project_slug,
    score: Number(row.rank ?? 0),
    explanation: [
      row.status === "approved"
        ? "Aprobación humana vigente"
        : "Coincidencia por nombre, ruta o metadatos",
      row.relation ? `Relación: ${row.relation}` : "Sin relación registrada",
    ],
  }));
}

export interface SearchFileCounts {
  matchingFiles: number;
  categoryCounts: Record<string, number>;
  truncated: boolean;
}

export function searchFileCounts(
  filters: SearchFilters,
  projectId?: string,
  db = openDatabase(),
  allowedFileIds?: readonly string[],
): SearchFileCounts {
  const matching = searchWhere(filters, projectId, allowedFileIds);
  const matchingFiles = Number(
    (db.prepare(
      `SELECT COUNT(*) AS count FROM files JOIN projects ON projects.id=files.project_id WHERE ${matching.where}`,
    ).get(...matching.params) as { count: number }).count,
  );
  const byCategory = searchWhere(
    { ...filters, category: "" },
    projectId,
    allowedFileIds,
  );
  const rows = db
    .prepare(
      `SELECT COALESCE(files.category_id,'unclassified') AS category,COUNT(*) AS count FROM files JOIN projects ON projects.id=files.project_id WHERE ${byCategory.where} GROUP BY COALESCE(files.category_id,'unclassified')`,
    )
    .all(...byCategory.params) as Array<{ category: string; count: number }>;
  const categoryCounts: Record<string, number> = Object.fromEntries([
    ["unclassified", 0],
    ...DOCUMENT_CATEGORIES.map(({ id }) => [id, 0]),
  ]);
  for (const row of rows) categoryCounts[row.category] = Number(row.count);
  return {
    matchingFiles,
    categoryCounts,
    truncated: matchingFiles > 50,
  };
}
export function getRelationGraph(
  projectId: string,
  db = openDatabase(),
): RelationGraph {
  const files = listProjectFiles(projectId, db);
  const projectMemberships = new Map<string, Array<{ id: string; name: string }>>();
  if (files.length) {
    const memberships = db.prepare(
      `SELECT fp.file_id AS fileId,p.id,p.name FROM file_projects fp JOIN projects p ON p.id=fp.project_id WHERE fp.file_id IN (${files.map(() => "?").join(",")}) ORDER BY p.name`,
    ).all(...files.map((file) => file.id)) as Array<{ fileId: string; id: string; name: string }>;
    for (const membership of memberships) {
      const current = projectMemberships.get(membership.fileId) ?? [];
      current.push({ id: membership.id, name: membership.name });
      projectMemberships.set(membership.fileId, current);
    }
  }
  const rows = db
    .prepare(
      "SELECT from_file_id AS fromFileId,to_file_id AS toFileId,relation AS type FROM file_relations WHERE from_file_id IN (SELECT id FROM files WHERE project_id=?) OR to_file_id IN (SELECT id FROM files WHERE project_id=?)",
    )
    .all(projectId, projectId) as any[];
  const edges = rows.map((row) => ({
    from: row.fromFileId,
    to: row.toFileId,
    type: row.type,
  }));
  return {
    nodes: files.map((file) => ({
      id: file.id,
      kind: "file" as const,
      label: file.filename,
      status: file.status,
      categoryId: file.categoryId,
      disciplineTag: file.tags.discipline,
      locationTag: file.tags.location,
      projects: projectMemberships.get(file.id) ?? [],
    })),
    edges,
  };
}
export function listFindings(
  projectId: string,
  db = openDatabase(),
): Finding[] {
  return db
    .prepare(
      "SELECT findings.id,findings.file_id AS fileId,findings.type,findings.reason,findings.evidence,findings.confidence,findings.state,findings.reviewed_at AS reviewedAt,findings.review_note AS reviewNote FROM findings JOIN files ON files.id=findings.file_id WHERE files.project_id=? ORDER BY findings.state,findings.id",
    )
    .all(projectId) as unknown as Finding[];
}
export function updateFinding(
  findingId: string,
  state: FindingState,
  note?: string,
  db = openDatabase(),
): Finding | null {
  const reviewedAt = now();
  db.prepare(
    "UPDATE findings SET state=?,reviewed_at=?,review_note=? WHERE id=?",
  ).run(state, reviewedAt, note?.trim() || null, findingId);
  const row = db
    .prepare(
      "SELECT id,file_id AS fileId,type,reason,evidence,confidence,state,reviewed_at AS reviewedAt,review_note AS reviewNote FROM findings WHERE id=?",
    )
    .get(findingId);
  if (!row) return null;
  db.prepare(
    "INSERT INTO audit_events (event_type,entity_id,actor,payload,created_at) VALUES (?,?,?,?,?)",
  ).run(
    `finding_${state}`,
    findingId,
    "demo-reviewer",
    JSON.stringify({ state, note: note?.trim() || null }),
    reviewedAt,
  );
  return row as unknown as Finding;
}

export function reviewFile(
  fileId: string,
  decision: ReviewDecision,
  reviewer: string,
  reason: string | undefined,
  db = openDatabase(),
): DocumentFile | null {
  const file = getFile(fileId, db);
  if (!file) return null;
  if (file.status !== "pending_review")
    throw new Error("Only pending files can be reviewed.");
  if (decision === "return" && !reason?.trim())
    throw new Error("A reason is required when returning a classification.");
  const reviewedAt = now();
  const nextStatus = decision === "approve" ? "approved" : "returned";
  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE files SET status=?,reviewer=?,reviewed_at=?,review_reason=?,updated_at=? WHERE id=?",
    ).run(
      nextStatus,
      reviewer,
      reviewedAt,
      reason?.trim() ?? null,
      reviewedAt,
      fileId,
    );
    db.prepare(
      "INSERT INTO reviews (file_id,reviewer,decision,reason,reviewed_at,classification_snapshot) VALUES (?,?,?,?,?,?)",
    ).run(
      fileId,
      reviewer,
      decision,
      reason?.trim() ?? null,
      reviewedAt,
      JSON.stringify(file),
    );
    db.prepare(
      "INSERT INTO audit_events (event_type,entity_id,actor,payload,created_at) VALUES (?,?,?,?,?)",
    ).run(
      `file_${decision}`,
      fileId,
      reviewer,
      JSON.stringify({ before: file.status, after: nextStatus }),
      reviewedAt,
    );
    db.prepare(
      "INSERT INTO decision_events (id,review_item_id,file_id,entity_type,entity_id,event_type,actor_id,actor_name,actor_role,occurred_at,context_json,demo_owned) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      null,
      fileId,
      "file_classification",
      fileId,
      decision,
      reviewer,
      reviewer,
      null,
      reviewedAt,
      JSON.stringify({
        reason: reason?.trim() ?? null,
        before: { fileStatus: file.status },
        after: { fileStatus: nextStatus },
      }),
      file.demoOwned ? 1 : 0,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getFile(fileId, db);
}
export function addMockedUpload(
  projectId: string,
  filename: string,
  db = openDatabase(),
): DocumentFile {
  const safeName = path.basename(filename || "nuevo-documento.pdf");
  const id = `demo-upload-${Date.now().toString(36)}`;
  const timestamp = now();
  const extension = path.extname(safeName).toLowerCase();
  db.prepare(
    "INSERT INTO files (id,project_id,stable_identity,filename,source_path,extension,size_bytes,modified_at,document_type,status,index_state,metadata_text,created_at,updated_at,demo_owned,preview_kind,preview_title,preview_content) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    projectId,
    `demo-upload:${projectId}:${id}`,
    safeName,
    `simulated://intake/${safeName}`,
    extension,
    0,
    timestamp,
    "other",
    "pending_ingestion",
    "simulated",
    `${safeName} ingreso simulado`,
    timestamp,
    timestamp,
    1,
    "unavailable",
    "Vista pendiente",
    "Archivo simulado; no se escribió en la fuente.",
  );
  db.prepare(
    "INSERT INTO decision_events (id,review_item_id,file_id,entity_type,entity_id,event_type,actor_id,actor_name,actor_role,occurred_at,context_json,demo_owned) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)",
  ).run(
    randomUUID(),
    null,
    id,
    "file_classification",
    id,
    "indexed",
    "system",
    "System",
    null,
    timestamp,
    JSON.stringify({ after: { fileStatus: "pending_ingestion" } }),
  );
  rebuildSearchIndex(db);
  return getFile(id, db)!;
}
export function confirmMockedUpload(
  fileId: string,
  documentType: string,
  db = openDatabase(),
): DocumentFile | null {
  const timestamp = now();
  db.prepare(
    "UPDATE files SET status='pending_review',document_type=?,metadata_text=metadata_text || ' ' || ?,updated_at=? WHERE id=? AND demo_owned=1 AND status='pending_ingestion'",
  ).run(
    documentType || "other",
    "metadatos sugeridos confirmados",
    timestamp,
    fileId,
  );
  rebuildSearchIndex(db);
  return getFile(fileId, db);
}
export function upsertIndexedFile(
  input: {
    projectId: string;
    sourcePath: string;
    filename: string;
    extension: string;
    sizeBytes: number;
    modifiedAt: string;
    documentType: string;
    indexState?: string;
  },
  db = openDatabase(),
): void {
  const timestamp = now();
  const stableIdentity = input.sourcePath;
  const existing = db
    .prepare("SELECT id FROM files WHERE stable_identity=?")
    .get(stableIdentity) as { id: string } | undefined;
  db.prepare(
    "INSERT INTO files (id,project_id,stable_identity,filename,source_path,extension,size_bytes,modified_at,document_type,status,index_state,metadata_text,created_at,updated_at,demo_owned) VALUES (lower(hex(randomblob(16))),?,?,?,?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(stable_identity) DO UPDATE SET filename=excluded.filename,extension=excluded.extension,size_bytes=excluded.size_bytes,modified_at=excluded.modified_at,document_type=excluded.document_type,index_state=excluded.index_state,updated_at=excluded.updated_at",
  ).run(
    input.projectId,
    stableIdentity,
    input.filename,
    input.sourcePath,
    input.extension,
    input.sizeBytes,
    input.modifiedAt,
    input.documentType,
    "pending_review",
    input.indexState ?? "indexed",
    `${input.filename} ${input.sourcePath} ${input.documentType}`,
    timestamp,
    timestamp,
  );
  if (!existing) {
    const row = db
      .prepare("SELECT id FROM files WHERE stable_identity=?")
      .get(stableIdentity) as { id: string };
    db.prepare(
      "INSERT INTO decision_events (id,review_item_id,file_id,entity_type,entity_id,event_type,actor_id,actor_name,actor_role,occurred_at,context_json,demo_owned) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)",
    ).run(
      randomUUID(),
      null,
      row.id,
      "file_classification",
      row.id,
      "indexed",
      "system",
      "System",
      null,
      input.modifiedAt,
      JSON.stringify({ after: { fileStatus: "pending_review" } }),
    );
  }
  rebuildSearchIndex(db);
}
