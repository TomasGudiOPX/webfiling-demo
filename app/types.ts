export type FileStatus =
  | "approved"
  | "pending_review"
  | "pending_ingestion"
  | "superseded"
  | "returned"
  | "missing_metadata";

export type ReviewDecision = "approve" | "return";

export type RelationType =
  | "supersedes"
  | "related to"
  | "awaiting confirmation";
export type FindingType =
  | "missing_metadata"
  | "possible_duplicate"
  | "uncertain_relation";
export type FindingState = "open" | "confirmed" | "edited" | "dismissed";
export type ReviewItemState =
  | "unassigned"
  | "assigned"
  | "escalated"
  | "completed";
export type ReviewTargetKind = "file_classification" | "finding";
export type ReviewSeverity = "critical" | "high" | "normal" | "low";
export type ReviewPriority = ReviewSeverity;
export type GovernanceDecision =
  | "approve"
  | "return"
  | "resolve"
  | "dismiss"
  | "escalate";
export type DemoRole =
  | "Document controller"
  | "Technical lead"
  | "Site manager"
  | "Project manager";

export interface DemoIdentity {
  id: string;
  name: string;
  role: DemoRole;
}
export interface ReviewItem {
  id: string;
  projectId: string;
  fileId: string;
  targetKind: ReviewTargetKind;
  targetId: string;
  state: ReviewItemState;
  severity: ReviewSeverity;
  priority: ReviewPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeRole: DemoRole | null;
  dueAt: string;
  escalationReason: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  projectName?: string;
  projectSlug?: string;
  filename?: string;
  findingType?: FindingType;
  finalOutcome?: GovernanceDecision | null;
}
export interface DecisionEvent {
  id: string;
  reviewItemId: string | null;
  fileId: string | null;
  entityType: string;
  entityId: string;
  eventType: string;
  actorId: string;
  actorName: string;
  actorRole: DemoRole | null;
  occurredAt: string;
  context: Record<string, unknown>;
}
export interface ReviewEvidencePacket {
  item: ReviewItem;
  file: DocumentFile;
  finding: Finding | null;
  relations: RelationFixture[];
  findings: Finding[];
  timeline: DecisionEvent[];
}

export interface PreviewDescriptor {
  kind: "pdf" | "markdown" | "image" | "docx" | "unavailable";
  title: string;
  url?: string;
  content?: string;
  sections?: string[];
  reason?: string;
}

export interface RelationFixture {
  from: string;
  to: string;
  type: RelationType;
}

export interface FindingFixture {
  id: string;
  fileId: string;
  type: FindingType;
  reason: string;
  evidence: string;
  confidence: number;
}

export interface ScenarioFileFixture {
  id: string;
  filename: string;
  sourcePath: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  documentType: string;
  status: FileStatus;
  metadataText: string;
  preview: PreviewDescriptor;
}

export interface ScenarioDefinition {
  slug: string;
  name: string;
  story: string;
  dominantIssue: string;
  recommendedQuery: string;
  sourceRoot: string;
  files: ScenarioFileFixture[];
  relations: RelationFixture[];
  findings: FindingFixture[];
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  sourceRoot: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentFile {
  id: string;
  projectId: string;
  filename: string;
  sourcePath: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  documentType: string;
  status: FileStatus;
  indexState: string;
  metadataText: string;
  reviewer: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  relation: string | null;
  preview: PreviewDescriptor | null;
  demoOwned?: boolean;
}

export interface SearchResult extends DocumentFile {
  projectName: string;
  projectSlug: string;
  score: number;
  explanation: string[];
}

export interface Finding extends FindingFixture {
  state: FindingState;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface RelationNode {
  id: string;
  kind: "file" | "project";
  label: string;
  status: string;
}

export interface RelationGraph {
  nodes: RelationNode[];
  edges: RelationFixture[];
}

export interface IndexHealth {
  status: string;
  finishedAt: string | null;
  indexedCount: number;
  errorCount: number;
  lastError: string | null;
}

export interface AsOfDocumentDecision {
  eventType: string;
  actorId: string;
  actorName: string;
  actorRole: DemoRole | null;
  occurredAt: string;
  rationale: string | null;
}

export interface AsOfDocument {
  id: string;
  filename: string;
  documentType: string;
  status: FileStatus;
  priorToFirstDecision: boolean;
  current: boolean;
  decision: AsOfDocumentDecision | null;
}

export interface TemporalSnapshot {
  at: string;
  projectId: string;
  documents: AsOfDocument[];
  currentDocumentIds: string[];
}

export const classificationEventStatuses: Record<string, FileStatus> = {
  approve: "approved",
  return: "returned",
  superseded: "superseded",
};

export function decisionEventStatus(
  eventType: string,
  context: Record<string, unknown> = {},
): FileStatus {
  if (eventType === "indexed") {
    const after = context.after as { fileStatus?: FileStatus } | undefined;
    return after?.fileStatus ?? "pending_review";
  }
  return classificationEventStatuses[eventType] ?? "pending_review";
}
