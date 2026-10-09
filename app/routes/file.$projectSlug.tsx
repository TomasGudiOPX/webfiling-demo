import { useState, type ReactNode } from "react";
import { Form, Link, redirect, useNavigate } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  addMockedUpload,
  confirmMockedUpload,
  getFile,
  getHealth,
  getProject,
  getRelationGraph,
  listFindings,
  listProjectFiles,
  openDatabase,
  resetDemoFixtures,
  reviewFile,
  searchFileCounts,
  searchFiles,
  seedFixtures,
  updateFinding,
} from "../.server/db.server";
import {
  reconstructAsOf,
  type ReconstructionResult,
} from "../.server/reconstruction.server";
import { getScenario, scenarioRegistry } from "../scenarios";
import { parseSearchFilters, workspaceUrl } from "../search-filters";
import { DOCUMENT_CATEGORIES } from "../types";
import {
  groupDocumentRevisions,
  matchRevisionGroups,
  relatedDocumentUrl,
  supersessionPredecessors,
} from "../document-navigation";
import { RelationGraph } from "../components/relation-graph";
import "../styles/showcase.css";
import { DocumentPreview } from "../components/document-preview";
import {
  listDecisionEvents,
  listReviewItems,
} from "../.server/governance.server";
import { readableFileIds } from "../.server/file-access.server";
import { resolveDemoProfile } from "../.server/profile-session.server";
import type {
  AsOfDocument,
  AsOfDocumentDecision,
  DocumentFile,
  FindingState,
  SearchResult,
} from "../types";
import type { SearchFilters } from "../search-filters";

export function loader({ params, request }: LoaderFunctionArgs) {
  const db = openDatabase();
  seedFixtures(db);
  const readableIds = new Set(readableFileIds(resolveDemoProfile(request), db));
  const scenario = getScenario(params.projectSlug ?? "");
  if (!scenario) throw redirect("/file");
  const project = getProject(scenario.slug, db);
  if (!project) throw redirect("/file");

  const url = new URL(request.url);
  const parsedFilters = parseSearchFilters(url.searchParams);
  const { filters, invalid: invalidFilters } = parsedFilters;
  const { query, scope, status, type, timeframe, sort } = filters;
  const selectedId =
    url.searchParams.get("selected") ?? url.searchParams.get("evidence") ?? "";
  const files = searchFiles(
    filters,
    scope === "project" ? project.id : undefined,
    db,
    [...readableIds],
  );
  const selected = selectedId
    ? (readableIds.has(selectedId) ? getFile(selectedId, db) : null)
    : files[0] ?? null;
  const selectedProject = selected ? getProject(selected.projectId, db) : null;

  const allFiles = listProjectFiles(project.id, db).filter((file) =>
    readableIds.has(file.id),
  );
  const contextProjectIds = new Set([
    project.id,
    ...files.map((file) => file.projectId),
    ...(selected ? [selected.projectId] : []),
  ]);
  const contextFiles = [...contextProjectIds].flatMap((projectId) =>
    listProjectFiles(projectId, db).filter((file) => readableIds.has(file.id)),
  );
  const filterGraph = (graph: ReturnType<typeof getRelationGraph>) => ({
    nodes: graph.nodes.filter((node) => readableIds.has(node.id)),
    edges: graph.edges.filter(
      (edge) => readableIds.has(edge.from) && readableIds.has(edge.to),
    ),
  });
  const graph = filterGraph(getRelationGraph(project.id, db));
  const contextGraphs = [...contextProjectIds].map((projectId) =>
    projectId === project.id ? graph : filterGraph(getRelationGraph(projectId, db)),
  );
  const contextRevisionGroups = groupDocumentRevisions(
    contextFiles,
    contextGraphs.flatMap((item) => item.edges),
  );
  const selectedRevisionGroup = contextRevisionGroups.find((group) =>
    group.files.some((file) => file.id === selected?.id),
  ) ?? null;
  const revisionGroups = matchRevisionGroups(
    contextRevisionGroups,
    files,
    selected?.id,
  );
  const relationEdges = [
    ...new Map(
      contextGraphs
        .flatMap((item) => item.edges)
        .map((edge) => [`${edge.from}\u0000${edge.to}\u0000${edge.type}`, edge]),
    ).values(),
  ];
  const predecessorIds = selected
    ? supersessionPredecessors(selected.id, contextFiles, relationEdges).map(
        (file) => file.id,
      )
    : [];
  const predecessors = contextFiles.filter((file) => predecessorIds.includes(file.id));
  const reviewItems = listReviewItems({});
  const openReviewItems = reviewItems.filter(
    (item) => item.projectId === project.id && item.state !== "completed",
  );
  const selectedRelations = selected
    ? relationEdges.filter(
        (edge) => edge.from === selected.id || edge.to === selected.id,
      )
    : [];
  const relatedDocuments = selectedRelations.map((relation) => {
    const outgoing = relation.from === selected?.id;
    const targetId = outgoing ? relation.to : relation.from;
    const target = getFile(targetId);
    const targetProject = target ? getProject(target.projectId) : null;
    const targetFindings = targetProject ? listFindings(targetProject.id) : [];
    const ownerFindings = selectedProject
      ? listFindings(selectedProject.id)
      : [];
    const finding =
      relation.type === "awaiting confirmation"
        ? [...ownerFindings, ...targetFindings].find(
            (item) =>
              item.type === "uncertain_relation" &&
              (item.fileId === selected?.id || item.fileId === targetId),
          )
        : undefined;
    const reviewItem = finding
      ? reviewItems.find(
          (item) => item.targetKind === "finding" && item.targetId === finding.id,
        )
      : undefined;
    const targetSlug = targetProject?.slug;
    return {
      relation,
      direction: outgoing ? "outgoing" as const : "incoming" as const,
      targetId,
      target,
      targetProject,
      href: relatedDocumentUrl(
        target && targetSlug ? { ...target, projectSlug: targetSlug } : null,
        selected?.projectId ?? "",
        filters,
      ),
      finding,
      reviewHref: finding
        ? reviewItem
          ? `/file/review?selected=${encodeURIComponent(reviewItem.id)}`
          : "/file/review"
        : null,
    };
  });
  const selectedOutsideResults = Boolean(
    selectedId && selected && !files.some((file) => file.id === selected.id),
  );
  const selectedUnavailable = Boolean(selectedId && !selected);

  const at = url.searchParams.get("at") ?? "";
  const asOf: ReconstructionResult | null = at
    ? reconstructAsOf(project.id, at)
    : null;

  return {
    scenario,
    scenarios: scenarioRegistry,
    project,
    files,
    revisionGroups,
    selectedRevisionGroup,
    displayedDocumentCount: revisionGroups.length,
    predecessors,
    filters,
    counts: searchFileCounts(
      filters,
      scope === "project" ? project.id : undefined,
    ),
    selected,
    selectedProject,
    selectedRelations,
    relatedDocuments,
    selectedOutsideResults,
    selectedUnavailable,
    query,
    scope,
    status,
    type,
    timeframe,
    sort,
    category: filters.category,
    discipline: filters.discipline,
    location: filters.location,
    invalidFilters,
    at,
    asOf,
    graph,
    findings: listFindings(project.id),
    timeline: selected ? listDecisionEvents({ fileId: selected.id }) : [],
    health: getHealth(),
    stats: {
      vigentes: allFiles.filter((file) => file.status === "approved").length,
      porDecidir: allFiles.filter((file) => file.status === "pending_review")
        .length,
      vencidos: openReviewItems.filter(
        (item) => Date.parse(item.dueAt) < Date.now(),
      ).length,
      hallazgos: listFindings(project.id).filter(
        (finding) => finding.state === "open",
      ).length,
      criticos: openReviewItems.filter((item) => item.severity === "critical")
        .length,
    },
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  seedFixtures();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "reset") resetDemoFixtures();
    if (intent === "review-file")
      reviewFile(
        String(form.get("fileId") ?? ""),
        String(form.get("decision") ?? "return") as "approve" | "return",
        "demo-reviewer",
        String(form.get("reason") ?? ""),
      );
    if (intent === "finding")
      updateFinding(
        String(form.get("findingId") ?? ""),
        String(form.get("state") ?? "dismissed") as FindingState,
        String(form.get("note") ?? ""),
      );
    if (intent === "upload") {
      const entry = form.get("file");
      const name =
        typeof entry === "object" &&
        entry &&
        "name" in entry &&
        (entry as File).name
          ? String((entry as File).name)
          : String(form.get("filename") ?? "acta-simulada.pdf");
      const project = getProject(params.projectSlug ?? "");
      if (project) addMockedUpload(project.id, name);
    }
    if (intent === "confirm-upload")
      confirmMockedUpload(
        String(form.get("fileId") ?? ""),
        String(form.get("documentType") ?? "other"),
      );
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el estado de la demo.",
    };
  }
  return null;
}

const labels: Record<string, string> = {
  approved: "Vigente",
  pending_review: "Pendiente de revisión",
  pending_ingestion: "Pendiente de ingestión",
  superseded: "Superado",
  returned: "Devuelto",
  missing_metadata: "Faltan datos",
};

const findingLabels: Record<string, string> = {
  missing_metadata: "Metadatos faltantes",
  possible_duplicate: "Posible duplicado",
  uncertain_relation: "Relación incierta",
};

const documentTypeLabels: Record<string, string> = {
  plan: "Plano",
  notice: "Comunicación",
  other: "Otro documento",
  technical: "Memoria técnica",
  contract: "Contrato",
  log: "Bitácora",
  specification: "Especificación",
  financial: "Finanzas y presupuesto",
  logistics: "Logística y materiales",
  hse: "Seguridad e higiene",
  procurement: "Proveedores y subcontratos",
};

const relationLabels: Record<string, string> = {
  supersedes: "reemplaza",
  "related to": "relacionado con",
  "awaiting confirmation": "por confirmar",
};

function queryFor(values: Record<string, string | undefined>) {
  return new URLSearchParams(
    Object.entries(values)
      .filter(
        ([, value]) => value !== undefined && value !== null && value !== "",
      )
      .map(([key, value]) => [key, value!]),
  );
}

function extOf(filename: string) {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1, dot + 4).toUpperCase() : "DOC";
}

function documentTypeLabel(type: string) {
  return documentTypeLabels[type] ?? type;
}

function Collapsible({
  title,
  count,
  hint,
  children,
  initiallyOpen = false,
}: {
  title: string;
  count?: number;
  hint?: string;
  children: ReactNode;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <section className={`sidebar-section ${open ? "is-open" : "is-collapsed"}`}>
      <button
        type="button"
        className="sidebar-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="sidebar-toggle-title">
          {title}
          {count !== undefined && <em className="sidebar-count">{count}</em>}
        </span>
        <span className="sidebar-chevron">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="sidebar-body">{children}</div>}
      {!open && hint && <p className="sidebar-hint">{hint}</p>}
    </section>
  );
}

function sourceLabel(
  file: DocumentFile,
  project: { id: string; name: string },
  scenarios: readonly { slug: string; name: string }[],
) {
  const owner =
    file.projectId === project.id
      ? project.name
      : (scenarios.find((item) => `project-${item.slug}` === file.projectId)
          ?.name ?? "Obra");
  return `Servidor Z:\\OBRAS · ${owner} · ${documentTypeLabel(file.documentType)}`;
}

const AS_OF_MOMENTS: ReadonlyArray<{ label: string; at: string }> = [
  { label: "Antes del cambio de revisión", at: "2026-10-04T12:00:00.000Z" },
  { label: "Después del cambio de revisión", at: "2026-10-06T12:00:00.000Z" },
];

const asOfEventLabels: Record<string, string> = {
  approve: "Aprobado",
  return: "Devuelto",
  superseded: "Superado",
  indexed: "Indexado",
};

function toLocalInput(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function HistoricalMode({
  project,
  at,
  asOf,
  filters,
}: {
  project: { slug: string; name: string };
  at: string;
  asOf: ReconstructionResult | null;
  filters: SearchFilters;
}) {
  const validDate = Number.isFinite(Date.parse(at));
  return (
    <main className="shell workspace-shell historical-mode" data-testid="historical-mode">
      <header className="topbar">
        <Link className="brand" to="/file">webfiling<span className="brand-dot">·</span></Link>
        <span className="badge-tag">HISTÓRICO · SOLO LECTURA</span>
      </header>
      <section className="project-heading">
        <div>
          <p className="eyebrow">RECONSTRUCCIÓN TEMPORAL</p>
          <h1>{project.name}</h1>
          <p className="project-subtitle">Estado reconstruido al {validDate ? new Date(at).toLocaleString("es-AR") : at}</p>
        </div>
        <Link className="button secondary" to={workspaceUrl(project.slug, filters)}>Volver a hoy</Link>
      </section>
      <p className="selection-context" role="status" data-testid="filters-paused">
        Los filtros y datos actuales están pausados; esta vista muestra únicamente decisiones y documentos reconstruidos para la fecha elegida.
      </p>
      <details className="asof-control" open>
        <summary>Ver otra fecha</summary>
        <form className="asof-form" onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("at");
          if (typeof value === "string" && value) {
            const parsed = new Date(value);
            if (Number.isFinite(parsed.getTime())) window.location.assign(`/file/${project.slug}?at=${encodeURIComponent(parsed.toISOString())}`);
          }
        }}>
          <label htmlFor="historical-at">Fecha y hora:</label>
          <input id="historical-at" name="at" type="datetime-local" defaultValue={validDate ? toLocalInput(at) : ""} />
          <button className="button sm" type="submit">Aplicar</button>
        </form>
        <div className="asof-chips" aria-label="Momentos de decisión conocidos">
          {AS_OF_MOMENTS.map((moment) => <Link className="search-chip" key={moment.at} to={`/file/${project.slug}?at=${encodeURIComponent(moment.at)}`}>{moment.label}</Link>)}
        </div>
      </details>
      {asOf?.snapshot ? (
        <section className="panel historical-documents" aria-label="Documentos y decisiones en la fecha">
          <h2>Documentos y decisiones en esa fecha</h2>
          <div className="file-list" data-testid="asof-view">
            {asOf.snapshot.documents.map((document) => <AsOfDocumentRow key={document.id} document={document} />)}
          </div>
        </section>
      ) : (
        <div className="empty-state" data-testid="asof-error" role="alert">
          <h2>No se pudo reconstruir el estado</h2>
          <p>{asOf?.error?.message ?? "Fecha no válida."}</p>
        </div>
      )}
    </main>
  );
}

function decisionInEffect(decision: AsOfDocumentDecision) {
  const role = decision.actorRole ?? decision.actorName;
  const pieces = [
    asOfEventLabels[decision.eventType] ?? decision.eventType,
    role,
    new Date(decision.occurredAt).toLocaleString("es-AR"),
  ];
  if (decision.rationale) pieces.push(decision.rationale);
  return pieces.filter(Boolean).join(" · ");
}

function AsOfDocumentRow({ document }: { document: AsOfDocument }) {
  const ext = extOf(document.filename);
  return (
    <article
      className={`file-row asof-row ${document.current ? "row-approved" : ""} ${document.status === "superseded" ? "row-superseded" : ""}`}
      data-testid={`asof-row-${document.id}`}
    >
      <div className={`file-icon ext-${ext.toLowerCase()}`}>{ext}</div>
      <div className="file-main">
        <div className="file-title">
          <strong>{document.filename}</strong>
          <span className={`status ${document.status}`}>
            {labels[document.status] ?? document.status}
          </span>
          {document.current && (
            <span className="asof-current-badge" data-testid="asof-current-badge">
              vigente en esa fecha
            </span>
          )}
          {document.priorToFirstDecision && (
            <span
              className="asof-no-history-badge"
              data-testid="asof-no-history"
            >
              sin historial previo
            </span>
          )}
        </div>
        <p className="file-meta">
          <span>{documentTypeLabel(document.documentType)}</span>
        </p>
        <small className="asof-decision">
          {document.decision
            ? decisionInEffect(document.decision)
            : "Sin decisión registrada a esta fecha."}
        </small>
      </div>
    </article>
  );
}

function FileResultRow({
  file,
  selected,
  projectSlug,
  filters,
  findingCount,
  onSelect,
}: {
  file: SearchResult;
  selected: boolean;
  projectSlug: string;
  filters: SearchFilters;
  findingCount: number;
  onSelect: () => void;
}) {
  const ext = file.extension.replace(".", "").toUpperCase() || "DOC";
  return (
    <article
      className={`file-row ${selected ? "selected" : ""} ${file.status === "approved" ? "row-approved" : ""} ${file.status === "superseded" ? "row-superseded" : ""}`}
      data-testid={`file-row-${file.id}`}
    >
      <div className={`file-icon ext-${ext.toLowerCase()}`}>{ext}</div>
      <div className="file-main">
        <div className="file-title">
          <strong>{file.filename}</strong>
          <span className={`status ${file.status}`}>{labels[file.status] ?? file.status}</span>
          {findingCount > 0 && (
            <span className="finding-badge" title="Hallazgos abiertos detectados por el índice">
              ⚠ {findingCount} hallazgo(s)
            </span>
          )}
        </div>
        <p className="file-meta">
          <span>{documentTypeLabel(file.documentType)}</span>
          <span>·</span>
          <span>{new Date(file.modifiedAt).toLocaleDateString("es-AR")}</span>
          {file.sizeBytes > 0 && (
            <>
              <span>·</span>
              <span>{(file.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
            </>
          )}
        </p>
        <small className="result-project">Proyecto: {file.projectName}</small>
        <small className="file-explanation">{file.explanation[0]}</small>
      </div>
      <div className="file-action-cell">
        <Link
          className="button secondary sm"
          preventScrollReset
          onClick={onSelect}
          to={workspaceUrl(projectSlug, filters, file.id)}
        >
          Ver evidencia
        </Link>
      </div>
    </article>
  );
}

export default function Workspace({
  loaderData,
}: {
  loaderData: ReturnType<typeof loader>;
}) {
  const {
    project,
    scenario,
    scenarios,
    files,
    revisionGroups,
    selectedRevisionGroup,
    displayedDocumentCount,
    filters,
    counts,
    selected,
    selectedProject,
    relatedDocuments,
    selectedOutsideResults,
    selectedUnavailable,
    predecessors,
    query,
    scope,
    status,
    type,
    timeframe,
    sort,
    at,
    asOf,
    graph,
    findings,
    timeline,
    health,
    stats,
  } = loaderData;

  const navigate = useNavigate();
  const asOfActive = Boolean(at);

  // UX toggles
  const [showExplorerMock, setShowExplorerMock] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [compareChoice, setCompareChoice] = useState<{
    fileId: string;
    predecessorId: string;
  } | null>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [graphPreviewId, setGraphPreviewId] = useState<string | null>(null);
  const [filePage, setFilePage] = useState(0);
  const [rightPanel, setRightPanel] = useState<"evidence" | "actions">(
    "evidence",
  );
  const filePageCount = Math.max(1, Math.ceil(revisionGroups.length / 4));
  const visibleFilePage = Math.min(filePage, filePageCount - 1);

  const comparisonPredecessor =
    predecessors.length === 1
      ? predecessors[0]
      : predecessors.find(
          (file) =>
            file.id === compareChoice?.predecessorId &&
            selected?.id === compareChoice.fileId,
        ) ?? null;

  // Data detection surfacing: open findings per file + project total
  const openFindingsByFile = new Map<string, number>();
  for (const finding of findings) {
    if (finding.state !== "open") continue;
    openFindingsByFile.set(
      finding.fileId,
      (openFindingsByFile.get(finding.fileId) ?? 0) + 1,
    );
  }
  const openFindingsCount = findings.filter(
    (finding) => finding.state === "open",
  ).length;

  if (asOfActive) {
    return <HistoricalMode project={project} at={at} asOf={asOf} filters={filters} />;
  }

  return (
    <main className="shell workspace-shell">
      {/* Topbar */}
      <header className="topbar">
        <div className="brand-group">
          <Link className="brand" to="/file">
            webfiling<span className="brand-dot">·</span>
          </Link>
          <span className="badge-tag">{scenario.slug.toUpperCase()}</span>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className={`connectivity-toggle ${offlineMode ? "is-offline" : "is-online"}`}
            onClick={() => setOfflineMode(!offlineMode)}
            title="Simular conectividad de obra vs red central de oficina"
          >
            {offlineMode ? (
              <>
                <span className="status-dot offline-dot" />
                <span>Modo Obra (Caché local activa)</span>
              </>
            ) : (
              <>
                <span className="status-dot online-dot" />
                <span>Red Oficina (Servidor Z:\ Conectado)</span>
              </>
            )}
          </button>
          <span className="index-state">
            ●{" "}
            {health.status === "success" ? "Índice al día" : "Índice detenido"}
          </span>
          <Link className="back-link" to="/file/review">
            Cola de revisión
          </Link>
          <Link className="back-link" to="/file">
            ← Volver a Obras
          </Link>
        </div>
      </header>

      {/* Project Heading & Server Path Breadcrumb */}
      <section className="project-heading">
        <div className="heading-left">
          <div
            className="server-breadcrumb"
            title="Ruta en servidor Windows de la empresa"
          >
            <span className="breadcrumb-root">Este equipo</span>
            <span className="breadcrumb-sep">›</span>
            <span className="breadcrumb-drive">OBRAS (Z:)</span>
            <span className="breadcrumb-sep">›</span>
            <span className="breadcrumb-folder">02 - OBRAS EN CURSO</span>
            <span className="breadcrumb-sep">›</span>
            <span className="breadcrumb-active">{project.name}</span>
          </div>
          <p className="eyebrow">
            ESPACIO DE OBRA / {scenario.slug.toUpperCase()}
          </p>
          <h1>{project.name}</h1>
          <p className="project-subtitle">
            Fuente de red protegida · {files.length} documentos indexados ·{" "}
            {health.finishedAt
              ? `Sincronizado ${new Date(health.finishedAt).toLocaleTimeString("es-AR")}`
              : "Listo"}
          </p>
        </div>
        <div className="heading-right">
          <button
            type="button"
            className={`button contrast-mode-btn ${showExplorerMock ? "active" : ""}`}
            onClick={() => setShowExplorerMock(!showExplorerMock)}
          >
            {showExplorerMock
              ? "✕ Cerrar Vista Servidor"
              : "📂 Comparar con Carpetas Windows"}
          </button>
        </div>
      </section>

      {/* Project health strip */}
      <section className="health-strip" aria-label="Salud del proyecto">
        <Link
          className="health-stat"
          to={`/file/${project.slug}?${queryFor({ status: "approved" })}`}
        >
          <span className="health-stat-value">{stats.vigentes}</span>
          <span className="health-stat-label">Vigentes</span>
        </Link>
        <Link
          className="health-stat health-stat-warn"
          to={`/file/${project.slug}?${queryFor({ status: "pending_review" })}`}
        >
          <span className="health-stat-value">{stats.porDecidir}</span>
          <span className="health-stat-label">Por decidir</span>
        </Link>
        <Link
          className="health-stat health-stat-danger"
          to="/file/review?view=overdue&actor=document-controller"
        >
          <span className="health-stat-value">{stats.vencidos}</span>
          <span className="health-stat-label">Vencidos</span>
        </Link>
        <span className="health-stat">
          <span className="health-stat-value">{stats.hallazgos}</span>
          <span className="health-stat-label">Hallazgos</span>
        </span>
        <span
          className={`health-stat ${stats.criticos > 0 ? "health-stat-critical" : ""}`}
        >
          <span className="health-stat-value">{stats.criticos}</span>
          <span className="health-stat-label">Críticos</span>
        </span>
      </section>

      <details className="operations-brain" open>
        <summary>Cerebro de operaciones</summary>
        <RelationGraph
          graph={graph}
          selectedId={selected?.id}
          modalOpen={Boolean(graphPreviewId)}
          onSelectFile={(id) => {
            setRightPanel("evidence");
            navigate(workspaceUrl(project.slug, filters, id), { replace: true, preventScrollReset: true });
          }}
          onOpenFile={(id) => {
            setRightPanel("evidence");
            setGraphPreviewId(id);
            navigate(workspaceUrl(project.slug, filters, id), { replace: true, preventScrollReset: true });
          }}
        />
      </details>

      {/* As-of reconstruction control */}
      <details className="asof-control" data-testid="asof-control">
        <summary>Ver a una fecha</summary>
        <form
          className="asof-form"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("at");
            if (typeof value !== "string" || !value) return;
            const iso = new Date(value).toISOString();
            if (Number.isFinite(Date.parse(iso))) navigate(`/file/${project.slug}?${queryFor({ at: iso }).toString()}`);
          }}
        >
          <label htmlFor="at">Fecha y hora:</label>
          <input
            id="at"
            name="at"
            type="datetime-local"
            defaultValue=""
          />
          <button className="button sm" type="submit">
            Aplicar
          </button>
        </form>
        <div className="asof-chips" aria-label="Momentos de decisión conocidos">
          {AS_OF_MOMENTS.map((chip) => (
            <Link
              key={chip.at}
              className="search-chip"
              to={`/file/${project.slug}?${queryFor({ at: chip.at }).toString()}`}
            >
              {chip.label}
            </Link>
          ))}
        </div>
      </details>

      {/* Realistic Windows File Explorer Mockup Drawer (Screen 3: Contrast Sells) */}
      {showExplorerMock && (
        <section
          className="windows-explorer-mock"
          aria-label="Simulador de estructura tradicional de carpetas"
        >
          <div className="explorer-header">
            <span className="explorer-title">
              🗂️ Vista de Red Tradicional — Servidor Windows (Antes de
              Webfiling)
            </span>
            <span className="explorer-subtitle">
              Este es el laberinto de miles de carpetas que su equipo debe
              recorrer hoy
            </span>
          </div>
          <div className="explorer-address-bar">
            <span>Dirección:</span>
            <code>{`Z:\\02 - OBRAS EN CURSO\\${project.name}\\01 - Obras en Curso\\03 - C013 Obras Civiles\\...`}</code>
          </div>
          <div className="explorer-body">
            <div className="explorer-tree">
              <div className="tree-item drive">📁 ADMINISTRACION (Y:)</div>
              <div className="tree-item drive expanded">📂 OBRAS (Z:)</div>
              <div className="tree-item sub expanded">
                📂 02 - OBRAS EN CURSO
                <div className="tree-item sub-child">
                  📁 00 - ALQUILER EQUIPOS
                </div>
                <div className="tree-item sub-child">📁 87 - Minera Exar</div>
                <div className="tree-item sub-child active">
                  📂 {project.name}
                  <div className="tree-item sub-deep">📁 00 - General</div>
                  <div className="tree-item sub-deep">
                    📁 01 - C004 Taller Mecanico
                  </div>
                  <div className="tree-item sub-deep">
                    📁 03 - C013 Obras Civiles
                  </div>
                  <div className="tree-item sub-deep">
                    📁 05 - TSMD - Area Deposito
                  </div>
                  <div className="tree-item sub-deep">📁 20 - Mano de Obra</div>
                </div>
                <div className="tree-item sub-child">
                  📁 343 - Lotes Parque Industrial
                </div>
                <div className="tree-item sub-child">
                  📁 367 - Edificio WERCHOW
                </div>
              </div>
            </div>
            <div className="explorer-pain-note">
              <h4>⚠️ El dolor que resuelve Webfiling:</h4>
              <ul>
                <li>
                  <strong>Demoras de 20 a 45 minutos</strong> buscando en
                  subcarpetas de hasta 7 niveles de profundidad.
                </li>
                <li>
                  <strong>Imposible acceder en obra</strong> cuando se cae la
                  red o no hay Wi-Fi de oficina.
                </li>
                <li>
                  <strong>Riesgo de construir con planos superados</strong> al
                  no haber un estado de vigencia explícito.
                </li>
              </ul>
              <button
                type="button"
                className="button secondary sm"
                onClick={() => setShowExplorerMock(false)}
              >
                Volver a Búsqueda Inteligente Webfiling ➔
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Scenario Selector */}
      <nav className="scenario-selector" aria-label="Selector de escenarios">
        <span className="eyebrow">CAMBIAR OBRA:</span>
        {scenarios.map((item) => (
          <Link
            className={
              item.slug === scenario.slug
                ? "scenario-link active"
                : "scenario-link"
            }
            to={`/file/${item.slug}`}
            key={item.slug}
          >
            {item.name}
          </Link>
        ))}
      </nav>


      {/* Workspace Main Grid */}
      <section
        className={`workspace-grid ${rightOpen ? "" : "right-collapsed"}`}
      >
        <div className="workspace-main">
          {/* Section Heading with Explainability Banner if search active */}
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                DOCUMENTOS /{" "}
                {scope === "all" ? "RESULTADO GLOBAL" : scenario.slug}
              </p>
              <h2>
                {query ? `Resultados para “${query}”` : "Documentos de la obra"}
              </h2>
            </div>
            <span className="badge-count">
              {files.length} archivos · {displayedDocumentCount} documentos
              {counts.truncated && ` · mostrando ${files.length}`}
            </span>
          </div>

          {selectedOutsideResults && selected && (
            <p className="selection-context" role="status" data-testid="selected-outside-results">
              Este documento está <strong>fuera de los resultados actuales</strong>; se conserva como contexto de evidencia.
              {" "}
              <Link to={workspaceUrl(project.slug, filters)}>Volver a los resultados</Link>
            </p>
          )}
          {selectedUnavailable && (
            <p className="filter-warning" role="alert" data-testid="selected-unavailable">
              El documento solicitado ya no está disponible. No se seleccionó otro documento en su lugar.
              {" "}
              <Link to={workspaceUrl(project.slug, filters)}>Volver a los resultados</Link>
            </p>
          )}

          {openFindingsCount > 0 && (
            <p className="findings-summary" data-testid="findings-summary">
              ⚠ {openFindingsCount} hallazgo(s) abiertos detectados por el
              índice — requieren revisión humana en Gobernanza.
            </p>
          )}

          {/* Compact file manager */}
          <section className="file-manager" aria-label="Gestor de archivos">
          <div className="file-manager-heading">
            <div>
              <p className="eyebrow">ARCHIVOS</p>
              <h2>Documentos de la obra</h2>
            </div>
            <span className="badge-count">{files.length} archivos</span>
          </div>
          {files.length === 0 ? (
            <div className="empty-state">
              <h3>No hay resultados todavía</h3>
              <p>
                Prueba con “{scenario.recommendedQuery}” o cambia el alcance de
                búsqueda a todos los proyectos.
              </p>
            </div>
          ) : (
            <>
            <div className="file-carousel" aria-label="Archivos, desplazamiento horizontal">
              <div className="file-list">
              {revisionGroups.slice(visibleFilePage * 4, visibleFilePage * 4 + 4).map(({ group, matchingFiles, representative }) => {
                const rows = matchingFiles.map((file) => (
                  <FileResultRow
                    key={file.id}
                    file={file}
                    selected={file.id === selected?.id}
                    projectSlug={file.projectSlug}
                    filters={filters}
                    findingCount={openFindingsByFile.get(file.id) ?? 0}
                    onSelect={() => setRightPanel("evidence")}
                  />
                ));
                if (group.files.length === 1 && !group.ambiguous) return rows[0];
                return (
                  <details
                    className={`revision-group ${group.ambiguous ? "is-ambiguous" : ""}`}
                    key={group.id}
                    open={matchingFiles.some((file) => file.id === selected?.id)}
                  >
                    <summary>
                      <strong>{representative.filename}</strong>
                      <span>{matchingFiles.length} versión(es) coincidentes</span>
                      {group.current && matchingFiles.some((file) => file.id === group.current?.id) && (
                        <span>Vigente: {group.current.filename}</span>
                      )}
                      {group.ambiguous && <span>Linaje ambiguo</span>}
                    </summary>
                    <div className="revision-rows">{rows}</div>
                  </details>
                );
              })}
              </div>
            </div>
            <nav className="file-pagination" aria-label="Páginas de archivos">
              <button type="button" className="button sm" disabled={visibleFilePage === 0} onClick={() => setFilePage((page) => Math.max(0, page - 1))}>Anterior</button>
              <span>Página {visibleFilePage + 1} de {filePageCount}</span>
              <button type="button" className="button sm" disabled={visibleFilePage >= filePageCount - 1} onClick={() => setFilePage((page) => Math.min(filePageCount - 1, page + 1))}>Siguiente</button>
            </nav>
            </>
          )}
          <details className="manager-filter-disclosure">
            <summary>Buscar / cambiar tipo de archivo</summary>
            <Form method="get" className="manager-filter-form">
              <input type="hidden" name="scope" value={scope} />
              <input type="hidden" name="status" value={status} />
              <input type="hidden" name="discipline" value={filters.discipline ?? ""} />
              <input type="hidden" name="location" value={filters.location ?? ""} />
              <input type="hidden" name="timeframe" value={timeframe} />
              <input type="hidden" name="sort" value={sort} />
              <label>
                Buscar archivos
                <input
                  id="manager-query"
                  name="q"
                  type="search"
                  defaultValue={query}
                  placeholder={`ej. ${scenario.recommendedQuery}`}
                />
              </label>
              <label>
                Tipo de documento
                <select id="manager-type" name="type" defaultValue={type}>
                  <option value="">Todos los tipos</option>
                  {Object.entries(documentTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                Categoría
                <select
                  id="manager-category"
                  name="category"
                  defaultValue={filters.category ?? ""}
                >
                  <option value="">Todas las categorías</option>
                  {DOCUMENT_CATEGORIES.map(({ id, label }) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                  <option value="unclassified">Sin clasificar</option>
                </select>
              </label>
              <button className="button search-submit" type="submit">Aplicar</button>
            </Form>
          </details>
          </section>
        </div>

        {/* Right column: Evidencia / Gobernanza */}
        <div
          className={`right-column ${rightOpen ? "is-open" : "is-collapsed"}`}
        >
          <div
            className="right-tabs"
            role="tablist"
            aria-label="Paneles de la obra"
          >
            <button
              type="button"
              role="tab"
              aria-selected={rightPanel === "evidence"}
              className={rightPanel === "evidence" ? "is-active" : ""}
              onClick={() => setRightPanel("evidence")}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="3"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
              Evidencia
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={rightPanel === "actions"}
              className={rightPanel === "actions" ? "is-active" : ""}
              onClick={() => setRightPanel("actions")}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  x="5"
                  y="4"
                  width="14"
                  height="17"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="m9 12 2 2 4-4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Gobernanza
            </button>
            <button
              type="button"
              className="right-collapse"
              onClick={() => setRightOpen((value) => !value)}
              aria-expanded={rightOpen}
              aria-label={
                rightOpen ? "Ocultar panel lateral" : "Mostrar panel lateral"
              }
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d={rightOpen ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"}
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <div className="right-panels">
            {rightPanel === "evidence" ? (
              <div className="panel preview-panel">
                <p className="eyebrow">VISTA PREVIA / EVIDENCIA</p>
                {selected ? (
                  <>
                    <div className="preview-top-row">
                      <h2>{selected.filename}</h2>
                      <span className={`status ${selected.status}`}>
                        {labels[selected.status]}
                      </span>
                    </div>

                    <details className="full-evidence-disclosure">
                      <summary>Vista previa y detalles completos</summary>

                    {predecessors.length === 1 && (
                      <button
                        type="button"
                        className="compare-toggle-button"
                        onClick={() => setShowCompare((value) => !value)}
                      >
                        {showCompare
                          ? "Ocultar comparación"
                          : `Comparar con ${predecessors[0].filename}`}
                      </button>
                    )}
                    {predecessors.length > 1 && (
                      <div className="compare-choice">
                        <label>
                          Elegir predecesor
                          <select
                            aria-label="Elegir predecesor para comparar"
                            value={
                              compareChoice?.fileId === selected.id
                                ? compareChoice.predecessorId
                                : ""
                            }
                            onChange={(event) => {
                              setCompareChoice({
                                fileId: selected.id,
                                predecessorId: event.currentTarget.value,
                              });
                              setShowCompare(false);
                            }}
                          >
                            <option value="">Selecciona una versión</option>
                            {predecessors.map((predecessor) => (
                              <option key={predecessor.id} value={predecessor.id}>
                                {predecessor.filename} · {labels[predecessor.status]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="compare-toggle-button"
                          disabled={!comparisonPredecessor}
                          onClick={() => setShowCompare((value) => !value)}
                        >
                          Comparar versiones
                        </button>
                      </div>
                    )}

                    {showCompare && selected && comparisonPredecessor && (
                      <div className="compare-drawer">
                        <div className="compare-col current">
                          <span className="badge-tag">Documento seleccionado</span>
                          <strong>{selected.filename}</strong>
                          <p>
                            {labels[selected.status] ?? selected.status} ·{" "}
                            {new Date(selected.modifiedAt).toLocaleDateString(
                              "es-AR",
                            )}
                          </p>
                        </div>
                        <div className="compare-col old">
                          <span className="badge-tag">Predecesor registrado</span>
                          <strong>{comparisonPredecessor.filename}</strong>
                          <p>
                            {labels[comparisonPredecessor.status] ??
                              comparisonPredecessor.status}{" "}
                            · {new Date(
                              comparisonPredecessor.modifiedAt,
                            ).toLocaleDateString("es-AR")}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="preview-card">
                      <DocumentPreview
                        key={selected.id}
                        fileId={selected.id}
                        preview={selected.preview ?? {
                          kind: "unavailable",
                          title: selected.filename,
                          reason: "La evidencia y los metadatos siguen disponibles.",
                        }}
                        expandedOnMount={graphPreviewId === selected.id}
                        onDismiss={() => setGraphPreviewId(null)}
                      />
                    </div>

                    {/* Complete Provenance & Audit Fact Sheet */}
                    <details className="evidence-disclosure">
                      <summary>Procedencia y estado registrado</summary>
                    <dl className="evidence-facts">
                      <dt>Ruta en Servidor Z:\</dt>
                      <dd>
                        <code>{selected.sourcePath}</code>
                      </dd>

                      <dt>Proyecto de origen</dt>
                      <dd>{selectedProject?.name ?? "Proyecto no disponible"}</dd>

                      <dt>Origen</dt>
                      <dd>{sourceLabel(selected, selectedProject ?? project, scenarios)}</dd>

                      <dt>Estado autoritativo</dt>
                      <dd>
                        <span className={`status ${selected.status}`}>
                          {labels[selected.status]}
                        </span>
                      </dd>

                      {selected.reviewer && selected.reviewedAt && (
                        <>
                          <dt>Revisado por</dt>
                          <dd>
                            <strong>{selected.reviewer}</strong>
                            <small>{" · "}{new Date(selected.reviewedAt).toLocaleString("es-AR")}</small>
                          </dd>
                        </>
                      )}

                      {selected.reviewReason && (
                        <>
                          <dt>Motivo de revisión</dt>
                          <dd>{selected.reviewReason}</dd>
                        </>
                      )}
                    </dl>
                    </details>
                    <section className="relation-list selected-relations" aria-label="Versiones del documento">
                      <h3>Versiones</h3>
                      {selectedRevisionGroup && selectedRevisionGroup.files.length > 1 ? (
                        <>
                          {selectedRevisionGroup.ambiguous && <p role="status">Linaje ambiguo: no se señala una versión vigente.</p>}
                          {!selectedRevisionGroup.ambiguous && selectedRevisionGroup.current && <p>Vigente según relación explícita: <strong>{selectedRevisionGroup.current.filename}</strong></p>}
                          <ul className="relation-cards">
                            {selectedRevisionGroup.files.map((version) => (
                              <li className="relation-card" key={version.id}>
                                <span className={`status ${version.status}`}>{labels[version.status] ?? version.status}</span>
                                <Link className="relation-doc" to={workspaceUrl(selectedProject?.slug ?? project.slug, filters, version.id)}>
                                  {version.filename}{version.id === selected.id ? " · seleccionado" : ""}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : <p>No hay otras versiones vinculadas por una relación de reemplazo explícita.</p>}
                    </section>
                    <section className="relation-list selected-relations" aria-label="Relaciones directas del documento">
                      <h3>Documentos relacionados</h3>
                      {relatedDocuments.length ? (
                        <ul className="relation-cards">
                          {relatedDocuments.map(({ relation, direction, targetId, target, targetProject, finding, reviewHref, href }) => {
                            const label = relation.type === "supersedes"
                              ? direction === "outgoing" ? "Reemplaza" : "Reemplazado por"
                              : relation.type === "awaiting confirmation"
                                ? "Relación por confirmar"
                                : "Relacionado con";
                            return (
                              <li className="relation-card selected-relation-card" key={`${relation.from}-${relation.to}-${relation.type}`}>
                                <span className={`relation-type type-${relation.type.replaceAll(" ", "-")}`}>{label}</span>
                                {target && href ? (
                                  <Link className="relation-doc" preventScrollReset to={href}>
                                    <span className={`relation-icon ext-${extOf(target.filename).toLowerCase()}`}>{extOf(target.filename)}</span>
                                    <span className="relation-filename">{target.filename}</span>
                                  </Link>
                                ) : (
                                  <span className="relation-unavailable" role="status">
                                    Documento relacionado no disponible ({targetId})
                                  </span>
                                )}
                                {targetProject && <small className="result-project">Proyecto: {targetProject.name}</small>}
                                {finding && (
                                  <small className="relation-uncertainty">
                                    Relación sugerida; requiere confirmación humana. {reviewHref && <Link to={reviewHref}>Revisar hallazgo</Link>}
                                  </small>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p>No hay relaciones directas registradas para este documento.</p>
                      )}
                    </section>
                    <section
                      className="relation-list"
                      aria-label="Decisiones del documento"
                    >
                      <h3>Historial</h3>
                      {timeline.length ? (
                        timeline.map((event) => (
                          <p key={event.id}>
                            <strong>{event.eventType}</strong> ·{" "}
                            {event.actorName} ·{" "}
                            {new Date(event.occurredAt).toLocaleString("es-AR")}
                          </p>
                        ))
                      ) : (
                        <p>
                          Aún no se registraron decisiones para este documento.
                        </p>
                      )}
                    </section>
                    </details>
                  </>
                ) : (
                  <p>
                    Selecciona un archivo para ver su evidencia y procedencia.
                  </p>
                )}
              </div>
            ) : (
              <aside className="evidence" aria-label="Evidencia y acciones">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">GOBERNANZA</p>
                    <h2>Revisión y Acciones</h2>
                  </div>
                </div>
                <div className="evidence-body">
                  <p className="simulated-note">
                    Las sugerencias de IA requieren ratificación humana antes de
                    convertirse en datos oficiales.
                  </p>

                  {/* AI Findings */}
                  <Collapsible
                    title="Hallazgos del índice"
                    count={
                      findings.filter((finding) => finding.state === "open")
                        .length
                    }
                    hint={`${findings.length} hallazgo(s) detectados por el índice`}
                  >
                    {findings.length ? (
                      <div className="finding-list">
                        {findings.map((finding) => (
                          <article
                            className={`finding ${finding.state}`}
                            key={finding.id}
                          >
                            <div className="finding-header">
                              <span className="status">
                                {findingLabels[finding.type]}
                              </span>
                              <span className="confidence-pill">
                                {Math.round(finding.confidence * 100)}% conf.
                              </span>
                            </div>
                            <strong>{finding.reason}</strong>
                            <small className="finding-evidence">
                              {finding.evidence}
                            </small>
                            <small className="finding-state-text">
                              Estado: {finding.state}
                            </small>
                            {finding.state === "open" && (
                              <div className="finding-actions">
                                <Form method="post">
                                  <input
                                    type="hidden"
                                    name="intent"
                                    value="finding"
                                  />
                                  <input
                                    type="hidden"
                                    name="findingId"
                                    value={finding.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="state"
                                    value="confirmed"
                                  />
                                  <button className="button sm" type="submit">
                                    Confirmar
                                  </button>
                                </Form>
                                <Form method="post">
                                  <input
                                    type="hidden"
                                    name="intent"
                                    value="finding"
                                  />
                                  <input
                                    type="hidden"
                                    name="findingId"
                                    value={finding.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="state"
                                    value="dismissed"
                                  />
                                  <button
                                    className="button secondary sm"
                                    type="submit"
                                  >
                                    Descartar
                                  </button>
                                </Form>
                              </div>
                            )}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">
                        No hay hallazgos abiertos para esta obra.
                      </p>
                    )}
                  </Collapsible>

                  {/* Human Review */}
                  {selected?.status === "pending_review" && (
                    <Collapsible
                      title="Revisión técnica"
                      hint="Requiere ratificación humana"
                    >
                      <Form method="post" className="review-form">
                        <input
                          type="hidden"
                          name="intent"
                          value="review-file"
                        />
                        <input
                          type="hidden"
                          name="fileId"
                          value={selected.id}
                        />
                        <div className="review-box-header">
                          <strong>Revisar clasificación técnica</strong>
                          <span className="eyebrow">DECISIÓN HUMANA</span>
                        </div>
                        <button
                          className="button primary-approve"
                          name="decision"
                          value="approve"
                        >
                          ✓ Aprobar clasificación (Declarar Vigente)
                        </button>
                        <label htmlFor="reason">
                          Motivo en caso de devolución:
                        </label>
                        <textarea
                          id="reason"
                          name="reason"
                          placeholder="Escribe qué corrección o verificación requiere el equipo técnico..."
                        />
                        <button
                          className="button secondary"
                          name="decision"
                          value="return"
                        >
                          Devolver a revisión
                        </button>
                      </Form>
                    </Collapsible>
                  )}

                  {/* Field Intake */}
                  <Collapsible
                    title="Ingesta de campo"
                    hint="Subida simulada desde obra; no toca la fuente"
                  >
                    <Form
                      method="post"
                      encType="multipart/form-data"
                      className="intake-form"
                    >
                      <p className="intake-info">
                        Subida simulada desde el terreno. El archivo original en
                        el servidor Z:\ nunca se sobreescribe.
                      </p>
                      <input
                        type="file"
                        name="file"
                        aria-label="Archivo para incorporar"
                      />
                      <input
                        name="filename"
                        placeholder="o escribe un nombre de fixture.pdf"
                      />
                      <button
                        className="button secondary"
                        name="intent"
                        value="upload"
                      >
                        Crear Pending ingestion
                      </button>
                    </Form>

                    {files
                      .filter((file) => file.status === "pending_ingestion")
                      .map((file) => (
                        <Form
                          method="post"
                          className="intake-pending"
                          key={file.id}
                        >
                          <strong>{file.filename}</strong>
                          <span className="status pending_ingestion">
                            Pendiente de ingestión
                          </span>
                          <input
                            type="hidden"
                            name="intent"
                            value="confirm-upload"
                          />
                          <input type="hidden" name="fileId" value={file.id} />
                          <label>
                            Tipo sugerido{" "}
                            <select name="documentType" defaultValue="plan">
                              <option value="plan">Plano</option>
                              <option value="other">Otro</option>
                              <option value="notice">Comunicación</option>
                            </select>
                          </label>
                          <button className="button primary sm" type="submit">
                            Confirmar → Pending review
                          </button>
                        </Form>
                      ))}
                  </Collapsible>

                  {/* Demo data */}
                  <Collapsible
                    title="Datos de demo"
                    hint="Restaurar estado inicial"
                  >
                    <Form method="post" className="reset-form">
                      <input type="hidden" name="intent" value="reset" />
                      <button className="text-button reset-btn" type="submit">
                        🔄 Resetear datos de demo
                      </button>
                    </Form>
                  </Collapsible>
                </div>
              </aside>
            )}
          </div>
        </div>
      </section>

      {findings.some((finding) => finding.state === "open") && (
        <Form method="post" className="finding-edit-form">
          <input type="hidden" name="intent" value="finding" />
          <input
            type="hidden"
            name="findingId"
            value={findings.find((finding) => finding.state === "open")?.id}
          />
          <input type="hidden" name="state" value="edited" />
          <label htmlFor="finding-note">Editar hallazgo</label>
          <input id="finding-note" name="note" placeholder="Nota de revisión" />
          <button className="text-button" type="submit">
            Editar
          </button>
        </Form>
      )}
    </main>
  );
}
