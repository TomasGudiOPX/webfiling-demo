export type FileStatus =
  | "approved"
  | "pending_review"
  | "pending_ingestion"
  | "superseded"
  | "returned"
  | "missing_metadata";

export const DOCUMENT_CATEGORIES = [
  { id: "contracts", label: "Ficha y contratos" },
  { id: "finance", label: "Presupuesto y finanzas" },
  { id: "technical", label: "Documentación técnica" },
  { id: "progress-quality", label: "Avance y calidad" },
  { id: "logistics", label: "Logística y materiales" },
  { id: "people-safety", label: "Personal y seguridad" },
  { id: "subcontractors", label: "Subcontratistas" },
] as const;

export type DocumentCategoryId = (typeof DOCUMENT_CATEGORIES)[number]["id"];
export const DISCIPLINE_TAGS = {
  architecture: "Arquitectura",
  structures: "Estructuras",
  finance: "Finanzas",
  quality: "Calidad",
  logistics: "Logística",
  safety: "Seguridad e higiene",
  procurement: "Compras y contratos",
  "project-management": "Gestión de obra",
} as const;
export type DisciplineTagId = keyof typeof DISCIPLINE_TAGS;
export const LOCATION_TAGS = {
  "whole-site": "Obra completa",
  "north-sector": "Sector norte",
  "tower-a": "Torre A",
  facade: "Fachada",
  "level-07": "Nivel 7",
  "site-access": "Acceso a obra",
} as const;
export type LocationTagId = keyof typeof LOCATION_TAGS;

export interface DocumentOrganization {
  categoryId: DocumentCategoryId | null;
  tags: {
    discipline: DisciplineTagId | null;
    location: LocationTagId | null;
  };
}

export type FileOrigin = "source" | "fixture" | "managed_upload" | "legacy_simulated";
export type FileAvailability = "available" | "unavailable" | "processing" | "error";
export type DemoProfileId = "employee" | "manager" | "administration-staff" | "system-administrator";
export type CollectionKind = "project" | "shared" | "administration";
export type FileEventType =
  | "uploaded"
  | "metadata_changed"
  | "projects_changed"
  | "renamed"
  | "moved"
  | "trashed"
  | "restored";

export interface FileCollection {
  id: string;
  name: string;
  kind: CollectionKind;
  projectId: string | null;
  sampleOwned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FileProjectLink {
  fileId: string;
  projectId: string;
  createdAt: string;
}

export interface LibraryFileMetadata {
  fileId: string;
  collectionId: string;
  origin: FileOrigin;
  contentKey: string | null;
  managedFolderId: string | null;
  displayName: string;
  contributorId: string | null;
  availability: FileAvailability;
  trashedAt: string | null;
  sampleOwned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedFolder {
  id: string;
  collectionId: string;
  parentId: string | null;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface DemoProfile {
  id: DemoProfileId;
  displayName: string;
  isSystemAdministrator: boolean;
}

export interface CollectionGrant {
  profileId: DemoProfileId;
  collectionId: string;
  canRead: boolean;
  canContribute: boolean;
  canOrganize: boolean;
}

export interface FileEvent {
  id: string;
  fileId: string;
  eventType: FileEventType;
  actorId: DemoProfileId | string;
  occurredAt: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** Library identity is independent from the optional legacy primary project. */
export interface LibraryFileIdentity {
  id: string;
  primaryProjectId: string | null;
  projects: readonly FileProjectLink[];
  library: LibraryFileMetadata;
}

/** Facts returned by file APIs; legacy review details stay internal. */
export interface PublicFile {
  id: string;
  primaryProjectId: string | null;
  projects: readonly FileProjectLink[];
  filename: string;
  displayName: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  documentType: string;
  organization: DocumentOrganization;
  origin: FileOrigin;
  availability: FileAvailability;
  versions: {
    supersedes: readonly string[];
    supersededBy: readonly string[];
  };
  preview: PreviewDescriptor | null;
}

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

export interface ScenarioFileFixture extends DocumentOrganization {
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

export interface DocumentFile extends DocumentOrganization {
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
