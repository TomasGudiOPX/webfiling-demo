import { getProject, listProjectFiles, openDatabase } from "./db.server";
import { decisionEventStatus } from "../types";
import type {
  AsOfDocument,
  AsOfDocumentDecision,
  TemporalSnapshot,
} from "../types";

type Db = ReturnType<typeof openDatabase>;

export interface ReconstructionError {
  code: string;
  message: string;
}

export type ReconstructionResult =
  | { snapshot: TemporalSnapshot; error: null }
  | { snapshot: null; error: ReconstructionError };

const CLASSIFICATION_TYPES = new Set([
  "approve",
  "return",
  "superseded",
  "indexed",
]);

const STRICT_ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

function parseContext(contextJson: string): Record<string, unknown> {
  try {
    return JSON.parse(contextJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function validateAt(at: string): { ok: true; at: string } | { ok: false; error: ReconstructionError } {
  if (typeof at !== "string" || at.length === 0 || !STRICT_ISO.test(at)) {
    return {
      ok: false,
      error: {
        code: "invalid_timestamp",
        message: "at must be a valid ISO-8601 timestamp.",
      },
    };
  }
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) {
    return {
      ok: false,
      error: {
        code: "invalid_timestamp",
        message: "at must be a valid ISO-8601 timestamp.",
      },
    };
  }
  if (parsed > Date.now()) {
    return {
      ok: false,
      error: {
        code: "future_timestamp",
        message: "at must not be in the future.",
      },
    };
  }
  return { ok: true, at };
}

function decisionEvidence(row: any): AsOfDocumentDecision {
  const context = parseContext(row.context_json);
  return {
    eventType: row.event_type,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorRole: row.actor_role ?? null,
    occurredAt: row.occurred_at,
    rationale: typeof context.reason === "string" ? context.reason : null,
  };
}

function ingestionState(
  allEvents: any[],
  file: { id: string; status: string },
): string {
  const indexed = allEvents.find((event) => event.event_type === "indexed");
  if (indexed) {
    return decisionEventStatus("indexed", parseContext(indexed.context_json));
  }
  return file.status;
}

export function reconstructAsOf(
  projectId: string,
  at: string,
  db: Db = openDatabase(),
): ReconstructionResult {
  const project = getProject(projectId, db);
  if (!project) {
    return {
      snapshot: null,
      error: { code: "project_not_found", message: "Project was not found." },
    };
  }
  const validated = validateAt(at);
  if (!validated.ok) {
    return { snapshot: null, error: validated.error };
  }
  const atMs = Date.parse(validated.at);
  const files = listProjectFiles(project.id, db);

  const rows = db
    .prepare(
      `SELECT decision_events.* FROM decision_events
       JOIN files ON files.id = decision_events.entity_id
       WHERE decision_events.entity_type = 'file_classification'
         AND files.project_id = ?
       ORDER BY decision_events.occurred_at ASC, decision_events.rowid ASC`,
    )
    .all(project.id) as any[];

  const eventsByFile = new Map<string, any[]>();
  for (const row of rows) {
    if (!CLASSIFICATION_TYPES.has(row.event_type)) continue;
    const list = eventsByFile.get(row.entity_id) ?? [];
    list.push(row);
    eventsByFile.set(row.entity_id, list);
  }

  const documents: AsOfDocument[] = [];
  for (const file of files) {
    const allEvents = eventsByFile.get(file.id) ?? [];
    const events = allEvents.filter(
      (event) => Date.parse(event.occurred_at) <= atMs,
    );
    if (events.length === 0) {
      const status = ingestionState(allEvents, file);
      documents.push({
        id: file.id,
        filename: file.filename,
        documentType: file.documentType,
        status: status as AsOfDocument["status"],
        priorToFirstDecision: true,
        current: status === "approved",
        decision: null,
      });
      continue;
    }
    const last = events[events.length - 1];
    const status = decisionEventStatus(
      last.event_type,
      parseContext(last.context_json),
    );
    documents.push({
      id: file.id,
      filename: file.filename,
      documentType: file.documentType,
      status,
      priorToFirstDecision: false,
      current: status === "approved",
      decision: decisionEvidence(last),
    });
  }

  const currentDocumentIds = documents
    .filter((document) => document.current)
    .map((document) => document.id);

  return {
    snapshot: {
      at: validated.at,
      projectId: project.id,
      documents,
      currentDocumentIds,
    },
    error: null,
  };
}
