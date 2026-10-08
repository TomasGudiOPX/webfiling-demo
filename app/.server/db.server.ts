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
  PreviewDescriptor,
  Project,
  RelationGraph,
  ReviewDecision,
  SearchResult,
} from "../types";

type SqliteDatabase = DatabaseSync;
let cached: SqliteDatabase | undefined;
const DEMO_SLUGS = scenarioRegistry.map((scenario) => scenario.slug);

const schema = `
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, source_root TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, demo_owned INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), stable_identity TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, source_path TEXT NOT NULL, extension TEXT NOT NULL DEFAULT '', size_bytes INTEGER NOT NULL DEFAULT 0, modified_at TEXT NOT NULL, document_type TEXT NOT NULL DEFAULT 'other', status TEXT NOT NULL, index_state TEXT NOT NULL DEFAULT 'indexed', metadata_text TEXT NOT NULL DEFAULT '', reviewer TEXT, reviewed_at TEXT, review_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, demo_owned INTEGER NOT NULL DEFAULT 0, preview_kind TEXT, preview_title TEXT, preview_url TEXT, preview_content TEXT, preview_sections TEXT);
CREATE INDEX IF NOT EXISTS idx_files_project_status ON files(project_id, status);
CREATE INDEX IF NOT EXISTS idx_files_identity ON files(stable_identity);
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
}

export function openDatabase(
  databasePath = getConfig().databasePath,
): SqliteDatabase {
  if (cached && databasePath === getConfig().databasePath) return cached;
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  if (databasePath === getConfig().databasePath) cached = db;
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

export function resetDemoFixtures(db = openDatabase()): void {
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
            `SELECT id FROM files WHERE demo_owned=1 OR project_id IN (${projectIds.map(() => "?").join(",")})`,
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
          `SELECT id FROM review_items WHERE file_id IN (${marks}) OR demo_owned=1`,
        )
        .all(...fileIds) as Array<{ id: string }>;
      const reviewIds = reviewRows.map((row) => row.id);
      if (reviewIds.length)
        db.prepare(
          `DELETE FROM decision_events WHERE review_item_id IN (${reviewIds.map(() => "?").join(",")}) OR demo_owned=1`,
        ).run(...reviewIds);
      else db.prepare("DELETE FROM decision_events WHERE demo_owned=1").run();
      db.prepare(
        `DELETE FROM review_items WHERE file_id IN (${marks}) OR demo_owned=1`,
      ).run(...fileIds);
      db.prepare(
        `DELETE FROM findings WHERE file_id IN (${marks}) OR demo_owned=1`,
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
    if (projectIds.length)
      db.prepare(
        `DELETE FROM projects WHERE id IN (${projectIds.map(() => "?").join(",")})`,
      ).run(...projectIds);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const timestamp = "2026-10-07T12:00:00.000Z";
  const insertProject = db.prepare(
    "INSERT INTO projects (id,slug,name,source_root,created_at,updated_at,demo_owned) VALUES (@id,@slug,@name,@sourceRoot,@createdAt,@updatedAt,1)",
  );
  const insertFile = db.prepare(
    "INSERT INTO files (id,project_id,stable_identity,filename,source_path,extension,size_bytes,modified_at,document_type,status,index_state,metadata_text,created_at,updated_at,demo_owned,preview_kind,preview_title,preview_url,preview_content,preview_sections) VALUES (@id,@projectId,@stableIdentity,@filename,@sourcePath,@extension,@sizeBytes,@modifiedAt,@documentType,@status,'indexed',@metadataText,@createdAt,@updatedAt,1,@previewKind,@previewTitle,@previewUrl,@previewContent,@previewSections)",
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
      const { preview, ...fileValues } = file;
      insertFile.run({
        ...fileValues,
        projectId: project.id,
        stableIdentity: `demo:${scenario.slug}:${file.id}`,
        createdAt: timestamp,
        updatedAt: timestamp,
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
}
export function rebuildSearchIndex(db = openDatabase()): void {
  db.exec("DELETE FROM files_fts");
  db.prepare(
    "INSERT INTO files_fts (file_id,filename,source_path,project_name,document_type,metadata_text) SELECT files.id,files.filename,files.source_path,projects.name,files.document_type,files.metadata_text FROM files JOIN projects ON projects.id=files.project_id",
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

export function searchFiles(
  query: string,
  projectId?: string,
  status?: string,
  db = openDatabase(),
): SearchResult[] {
  const trimmed = query.trim();
  const conditions = ["1=1"];
  const condParams: Array<string> = [];
  if (projectId) {
    conditions.push("files.project_id=?");
    condParams.push(projectId);
  }
  if (status) {
    conditions.push("files.status=?");
    condParams.push(status);
  }

  let matchSql = "1=1";
  const searchParams: Array<string> = [];
  if (trimmed) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    const wordClauses = words.map(() => {
      return `(${["filename", "source_path", "metadata_text", "document_type"].map((field) => `${field} LIKE ?`).join(" OR ")})`;
    });
    matchSql = wordClauses.join(" AND ");
    for (const word of words) {
      searchParams.push(...Array(4).fill(`%${word}%`));
    }
  }

  const querySql = `SELECT files.*,(SELECT relation FROM file_relations r WHERE r.from_file_id=files.id OR r.to_file_id=files.id LIMIT 1) AS relation,projects.name AS project_name,projects.slug AS project_slug,0 AS rank FROM files JOIN projects ON projects.id=files.project_id WHERE ${matchSql} AND ${conditions.join(" AND ")} ORDER BY CASE files.status WHEN 'approved' THEN 0 WHEN 'pending_review' THEN 1 WHEN 'pending_ingestion' THEN 2 ELSE 3 END, modified_at DESC LIMIT 50`;

  const rows = db
    .prepare(querySql)
    .all(...searchParams, ...condParams) as any[];
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
export function getRelationGraph(
  projectId: string,
  db = openDatabase(),
): RelationGraph {
  const files = listProjectFiles(projectId, db);
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
