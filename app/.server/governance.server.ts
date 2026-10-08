import { randomUUID } from "node:crypto";
import { getFile, listFindings, openDatabase } from "./db.server";
import type {
  DecisionEvent,
  DemoIdentity,
  DemoRole,
  Finding,
  GovernanceDecision,
  ReviewEvidencePacket,
  ReviewItem,
  ReviewPriority,
  ReviewSeverity,
} from "../types";

type Db = ReturnType<typeof openDatabase>;
export const demoIdentities: readonly DemoIdentity[] = [
  {
    id: "document-controller",
    name: "Document controller",
    role: "Document controller",
  },
  { id: "technical-lead", name: "Technical lead", role: "Technical lead" },
  { id: "site-manager", name: "Site manager", role: "Site manager" },
  { id: "project-manager", name: "Project manager", role: "Project manager" },
];
const levels = new Set<ReviewSeverity>(["critical", "high", "normal", "low"]);
const time = () => new Date().toISOString();
const eventId = () => randomUUID();
const mapItem = (row: any): ReviewItem => ({
  id: row.id,
  projectId: row.project_id,
  fileId: row.file_id,
  targetKind: row.target_kind,
  targetId: row.target_id,
  state: row.state,
  severity: row.severity,
  priority: row.priority,
  assigneeId: row.assignee_id ?? null,
  assigneeName: row.assignee_name ?? null,
  assigneeRole: row.assignee_role ?? null,
  dueAt: row.due_at,
  escalationReason: row.escalation_reason ?? null,
  completedAt: row.completed_at ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  projectName: row.project_name,
  projectSlug: row.project_slug,
  filename: row.filename,
  findingType: row.finding_type ?? undefined,
  finalOutcome: row.final_outcome ?? null,
});
const mapEvent = (row: any): DecisionEvent => ({
  id: row.id,
  reviewItemId: row.review_item_id ?? null,
  fileId: row.file_id ?? null,
  entityType: row.entity_type,
  entityId: row.entity_id,
  eventType: row.event_type,
  actorId: row.actor_id,
  actorName: row.actor_name,
  actorRole: row.actor_role ?? null,
  occurredAt: row.occurred_at,
  context: JSON.parse(row.context_json),
});

function identity(actorId: string, role?: DemoRole) {
  const actor = demoIdentities.find((candidate) => candidate.id === actorId);
  if (!actor || (role && actor.role !== role))
    throw new Error("Invalid demo identity or role.");
  return actor;
}
function writeEvent(
  db: Db,
  input: {
    reviewItemId?: string | null;
    fileId?: string | null;
    entityType: string;
    entityId: string;
    eventType: string;
    actor: DemoIdentity | { id: string; name: string; role: null };
    context: Record<string, unknown>;
  },
) {
  const occurredAt = time();
  db.prepare(
    "INSERT INTO decision_events (id,review_item_id,file_id,entity_type,entity_id,event_type,actor_id,actor_name,actor_role,occurred_at,context_json,demo_owned) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)",
  ).run(
    eventId(),
    input.reviewItemId ?? null,
    input.fileId ?? null,
    input.entityType,
    input.entityId,
    input.eventType,
    input.actor.id,
    input.actor.name,
    input.actor.role,
    occurredAt,
    JSON.stringify(input.context),
  );
}
function itemRow(id: string, db: Db) {
  return db
    .prepare(
      "SELECT review_items.*,projects.name AS project_name,projects.slug AS project_slug,files.filename,findings.type AS finding_type FROM review_items JOIN projects ON projects.id=review_items.project_id JOIN files ON files.id=review_items.file_id LEFT JOIN findings ON review_items.target_kind='finding' AND findings.id=review_items.target_id WHERE review_items.id=?",
    )
    .get(id) as any;
}
function snapshot(item: ReviewItem, db: Db) {
  const file = getFile(item.fileId, db);
  if (!file) throw new Error("Document not found.");
  const finding =
    item.targetKind === "finding"
      ? ((db
          .prepare(
            "SELECT id,file_id AS fileId,type,reason,evidence,confidence,state,reviewed_at AS reviewedAt,review_note AS reviewNote FROM findings WHERE id=?",
          )
          .get(item.targetId) as Finding | undefined) ?? null)
      : null;
  const relations = db
    .prepare(
      "SELECT from_file_id AS 'from',to_file_id AS 'to',relation AS type FROM file_relations WHERE from_file_id=? OR to_file_id=?",
    )
    .all(file.id, file.id) as any[];
  return {
    file,
    finding,
    relations,
    context: {
      sourcePath: file.sourcePath,
      status: file.status,
      relations,
      finding: finding
        ? {
            type: finding.type,
            confidence: finding.confidence,
            evidence: finding.evidence,
          }
        : null,
    },
  };
}

export function listReviewItems(
  filters: { view?: string; assigneeId?: string } = {},
  db = openDatabase(),
): ReviewItem[] {
  const rows = db
    .prepare(
      "SELECT review_items.*,projects.name AS project_name,projects.slug AS project_slug,files.filename,findings.type AS finding_type FROM review_items JOIN projects ON projects.id=review_items.project_id JOIN files ON files.id=review_items.file_id LEFT JOIN findings ON review_items.target_kind='finding' AND findings.id=review_items.target_id ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, due_at ASC",
    )
    .all() as any[];
  const now = Date.now();
  return rows.map(mapItem).filter((item) => {
    if (filters.view === "completed") return item.state === "completed";
    if (filters.view === "unassigned") return item.state === "unassigned";
    if (filters.view === "overdue")
      return item.state !== "completed" && Date.parse(item.dueAt) < now;
    if (filters.view === "mine")
      return (
        item.state !== "completed" && item.assigneeId === filters.assigneeId
      );
    return item.state !== "completed";
  });
}
export function getReviewItem(
  id: string,
  db = openDatabase(),
): ReviewItem | null {
  const row = itemRow(id, db);
  return row ? mapItem(row) : null;
}
export function listDecisionEvents(
  input: { reviewItemId?: string; fileId?: string },
  db = openDatabase(),
): DecisionEvent[] {
  const column = input.reviewItemId ? "review_item_id" : "file_id";
  const value = input.reviewItemId ?? input.fileId;
  if (!value) return [];
  return (
    db
      .prepare(
        `SELECT * FROM decision_events WHERE ${column}=? ORDER BY occurred_at ASC`,
      )
      .all(value) as any[]
  ).map(mapEvent);
}
export type RecentDecision = DecisionEvent & {
  filename?: string;
  projectName?: string;
  projectSlug?: string;
};
export function listRecentDecisions(
  limit = 8,
  db = openDatabase(),
): RecentDecision[] {
  const rows = db
    .prepare(
      "SELECT decision_events.*,files.filename AS filename,projects.name AS project_name,projects.slug AS project_slug FROM decision_events LEFT JOIN files ON files.id=decision_events.file_id LEFT JOIN projects ON projects.id=files.project_id WHERE decision_events.actor_id != 'system' ORDER BY decision_events.occurred_at DESC LIMIT ?",
    )
    .all(limit) as any[];
  return rows.map((row) => ({
    ...mapEvent(row),
    filename: row.filename ?? undefined,
    projectName: row.project_name ?? undefined,
    projectSlug: row.project_slug ?? undefined,
  }));
}
export function getReviewQueueSummary(db = openDatabase()) {
  const rows = db
    .prepare(
      "SELECT severity, COUNT(*) AS count FROM review_items WHERE state != 'completed' GROUP BY severity",
    )
    .all() as Array<{ severity: string; count: number }>;
  const bySeverity: Record<ReviewSeverity, number> = {
    critical: 0,
    high: 0,
    normal: 0,
    low: 0,
  };
  let total = 0;
  for (const row of rows) {
    bySeverity[row.severity as ReviewSeverity] = row.count;
    total += row.count;
  }
  const overdue = (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM review_items WHERE state != 'completed' AND due_at < ?",
      )
      .get(new Date().toISOString()) as { count: number }
  ).count;
  return { total, bySeverity, overdue };
}
export function getReviewEvidence(
  id: string,
  db = openDatabase(),
): ReviewEvidencePacket | null {
  const item = getReviewItem(id, db);
  if (!item) return null;
  const { file, finding, relations } = snapshot(item, db);
  return {
    item,
    file,
    finding,
    relations: relations as any,
    findings: listFindings(item.projectId, db),
    timeline: listDecisionEvents({ reviewItemId: id }, db),
  };
}
export function assignReviewItem(
  id: string,
  actorId: string,
  assigneeId: string,
  assigneeRole: DemoRole,
  db = openDatabase(),
): ReviewItem {
  const actor = identity(actorId);
  const assignee = identity(assigneeId, assigneeRole);
  const item = getReviewItem(id, db);
  if (!item || item.state === "completed")
    throw new Error("Review item is not open.");
  const before = {
    assigneeId: item.assigneeId,
    assigneeRole: item.assigneeRole,
    state: item.state,
  };
  const updatedAt = time();
  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE review_items SET assignee_id=?,assignee_name=?,assignee_role=?,state='assigned',updated_at=? WHERE id=?",
    ).run(assignee.id, assignee.name, assignee.role, updatedAt, id);
    writeEvent(db, {
      reviewItemId: id,
      fileId: item.fileId,
      entityType: "review_item",
      entityId: id,
      eventType: "review_assigned",
      actor,
      context: {
        before,
        after: {
          assigneeId: assignee.id,
          assigneeRole: assignee.role,
          state: "assigned",
        },
      },
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getReviewItem(id, db)!;
}
export function updateReviewUrgency(
  id: string,
  actorId: string,
  input: { severity: ReviewSeverity; priority: ReviewPriority; dueAt: string },
  db = openDatabase(),
): ReviewItem {
  const actor = identity(actorId);
  const item = getReviewItem(id, db);
  if (!item || item.state === "completed")
    throw new Error("Review item is not open.");
  if (
    !levels.has(input.severity) ||
    !levels.has(input.priority) ||
    Number.isNaN(Date.parse(input.dueAt))
  )
    throw new Error("Invalid severity, priority, or due date.");
  const before = {
    severity: item.severity,
    priority: item.priority,
    dueAt: item.dueAt,
  };
  const updatedAt = time();
  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE review_items SET severity=?,priority=?,due_at=?,updated_at=? WHERE id=?",
    ).run(input.severity, input.priority, input.dueAt, updatedAt, id);
    writeEvent(db, {
      reviewItemId: id,
      fileId: item.fileId,
      entityType: "review_item",
      entityId: id,
      eventType: "urgency_updated",
      actor,
      context: { before, after: input },
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getReviewItem(id, db)!;
}
export function decideReviewItem(
  id: string,
  actorId: string,
  decision: GovernanceDecision,
  reason?: string,
  db = openDatabase(),
): ReviewItem {
  const actor = identity(actorId);
  const item = getReviewItem(id, db);
  if (!item || item.state === "completed")
    throw new Error("Review item is not open.");
  if (
    !["approve", "return", "resolve", "dismiss", "escalate"].includes(decision)
  )
    throw new Error("Invalid review decision.");
  if (["return", "dismiss", "escalate"].includes(decision) && !reason?.trim())
    throw new Error("A reason is required for this decision.");
  const { file, finding, context } = snapshot(item, db);
  const occurredAt = time();
  db.exec("BEGIN");
  try {
    if (decision === "escalate") {
      db.prepare(
        "UPDATE review_items SET state='escalated',escalation_reason=?,updated_at=? WHERE id=?",
      ).run(reason!.trim(), occurredAt, id);
    } else {
      if (item.targetKind === "file_classification") {
        if (!["approve", "return"].includes(decision))
          throw new Error(
            "File classifications can only be approved or returned.",
          );
        const next = decision === "approve" ? "approved" : "returned";
        if (file.status !== "pending_review")
          throw new Error("Only pending files can be reviewed.");
        db.prepare(
          "UPDATE files SET status=?,reviewer=?,reviewed_at=?,review_reason=?,updated_at=? WHERE id=?",
        ).run(
          next,
          actor.name,
          occurredAt,
          reason?.trim() ?? null,
          occurredAt,
          file.id,
        );
        db.prepare(
          "INSERT INTO reviews (file_id,reviewer,decision,reason,reviewed_at,classification_snapshot) VALUES (?,?,?,?,?,?)",
        ).run(
          file.id,
          actor.name,
          decision,
          reason?.trim() ?? null,
          occurredAt,
          JSON.stringify(file),
        );
      } else {
        if (!["resolve", "dismiss"].includes(decision) || !finding)
          throw new Error("Findings can only be resolved or dismissed.");
        const findingState = decision === "resolve" ? "confirmed" : "dismissed";
        db.prepare(
          "UPDATE findings SET state=?,reviewed_at=?,review_note=? WHERE id=?",
        ).run(findingState, occurredAt, reason?.trim() ?? null, finding.id);
      }
      db.prepare(
        "UPDATE review_items SET state='completed',completed_at=?,final_outcome=?,updated_at=? WHERE id=?",
      ).run(occurredAt, decision, occurredAt, id);
    }
    writeEvent(db, {
      reviewItemId: id,
      fileId: file.id,
      entityType: item.targetKind,
      entityId: item.targetId,
      eventType: decision,
      actor,
      context: {
        ...context,
        before: { fileStatus: file.status, itemState: item.state },
        reason: reason?.trim() ?? null,
      },
    });
    db.prepare(
      "INSERT INTO audit_events (event_type,entity_id,actor,payload,created_at) VALUES (?,?,?,?,?)",
    ).run(
      `review_${decision}`,
      id,
      actor.name,
      JSON.stringify({ reviewItemId: id, reason: reason?.trim() ?? null }),
      occurredAt,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getReviewItem(id, db)!;
}
