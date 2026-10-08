import { useState, type ReactNode } from "react";
import { Form, Link, redirect, useNavigate } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  addMockedUpload,
  confirmMockedUpload,
  getHealth,
  getProject,
  getRelationGraph,
  listFindings,
  listProjectFiles,
  resetDemoFixtures,
  reviewFile,
  searchFiles,
  seedFixtures,
  updateFinding,
} from "../.server/db.server";
import {
  reconstructAsOf,
  type ReconstructionResult,
} from "../.server/reconstruction.server";
import { getScenario, scenarioRegistry } from "../scenarios";
import { RelationGraph } from "../components/relation-graph";
import { DocumentPreview } from "../components/document-preview";
import {
  listDecisionEvents,
  listReviewItems,
} from "../.server/governance.server";
import type {
  AsOfDocument,
  AsOfDocumentDecision,
  DocumentFile,
  FindingState,
} from "../types";

export function loader({ params, request }: LoaderFunctionArgs) {
  seedFixtures();
  const scenario = getScenario(params.projectSlug ?? "");
  if (!scenario) throw redirect("/file");
  const project = getProject(scenario.slug);
  if (!project) throw redirect("/file");

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const scope = url.searchParams.get("scope") === "all" ? "all" : "project";
  const status = url.searchParams.get("status") ?? "";
  const type = url.searchParams.get("type") ?? "";
  const timeframe = ["7d", "30d", "90d", "year"].includes(
    url.searchParams.get("timeframe") ?? "",
  )
    ? (url.searchParams.get("timeframe") ?? "")
    : "";
  const sort = ["recent", "oldest", "name"].includes(
    url.searchParams.get("sort") ?? "",
  )
    ? (url.searchParams.get("sort") ?? "recent")
    : "recent";
  const selectedId =
    url.searchParams.get("selected") ?? url.searchParams.get("evidence") ?? "";
  let files =
    query || scope === "all"
      ? searchFiles(
          query,
          scope === "project" ? project.id : undefined,
          status || undefined,
        )
      : listProjectFiles(project.id);
  if (type) files = files.filter((file) => file.documentType === type);
  if (timeframe) {
    const days = timeframe === "year" ? 365 : Number.parseInt(timeframe, 10);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    files = files.filter((file) => Date.parse(file.modifiedAt) >= cutoff);
  }
  files = [...files].sort((left, right) => {
    if (sort === "name")
      return left.filename.localeCompare(right.filename, "es");
    const difference =
      Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt);
    return sort === "oldest" ? -difference : difference;
  });
  const selected =
    files.find((file) => file.id === selectedId) ?? files[0] ?? null;

  const allFiles = listProjectFiles(project.id);
  const openReviewItems = listReviewItems({}).filter(
    (item) => item.projectId === project.id && item.state !== "completed",
  );

  const at = url.searchParams.get("at") ?? "";
  const asOf: ReconstructionResult | null = at
    ? reconstructAsOf(project.id, at)
    : null;

  return {
    scenario,
    scenarios: scenarioRegistry,
    project,
    files,
    selected,
    query,
    scope,
    status,
    type,
    timeframe,
    sort,
    at,
    asOf,
    graph: getRelationGraph(project.id),
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

const timeframeLabels: Record<string, string> = {
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
  year: "Último año",
};

const sortLabels: Record<string, string> = {
  recent: "Más recientes",
  oldest: "Más antiguos",
  name: "Nombre A–Z",
};

const relationLabels: Record<string, string> = {
  supersedes: "reemplaza",
  "related to": "relacionado con",
  "awaiting confirmation": "requiere confirmación",
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

function relationLabel(relation: string | null | undefined) {
  return relation
    ? (relationLabels[relation] ?? relation)
    : "Sin relación registrada";
}

function Collapsible({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count?: number;
  hint?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
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

function AsOfEvidencePanel({ asOf }: { asOf: ReconstructionResult | null }) {
  if (!asOf || !asOf.snapshot) return null;
  const current = asOf.snapshot.documents.filter((document) => document.current);
  return (
    <div className="panel preview-panel">
      <p className="eyebrow">RECONSTRUCCIÓN / SOLO LECTURA</p>
      <h2>Estado a esta fecha</h2>
      <p className="muted">
        Esta vista es de solo lectura: no permite aprobar, devolver, subir ni
        modificar documentos.
      </p>
      <div className="asof-current-list">
        <p className="eyebrow">VIGENTES EN ESA FECHA</p>
        {current.length ? (
          current.map((document) => (
            <p key={document.id}>
              <strong>{document.filename}</strong>
            </p>
          ))
        ) : (
          <p className="muted">Ningún documento vigente a esta fecha.</p>
        )}
      </div>
    </div>
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
    selected,
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
  const [rightOpen, setRightOpen] = useState(true);
  const [rightPanel, setRightPanel] = useState<"evidence" | "actions">(
    "evidence",
  );

  // For version comparison Rev C vs Rev B
  const supersededFile = files.find((f) => f.status === "superseded");

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

      {/* As-of reconstruction control */}
      <section
        className="asof-control"
        data-testid="asof-control"
        aria-label="Reconstrucción as-of"
      >
        <div className="asof-control-head">
          <p className="eyebrow">CONSULTA TEMPORAL</p>
          <h2 className="asof-title">Así estaba</h2>
        </div>
        {asOfActive ? (
          <div className="asof-control-body">
            <span className="asof-label" data-testid="asof-label">
              Viendo la obra al {new Date(at).toLocaleString("es-AR")}
            </span>
            <Link className="button secondary sm" to={`/file/${project.slug}`}>
              Volver a hoy
            </Link>
          </div>
        ) : (
          <Link
            className="button secondary sm"
            to={`/file/${project.slug}?at=${AS_OF_MOMENTS[1].at}`}
          >
            ¿Qué estaba vigente en otra fecha?
          </Link>
        )}
        <form
          className="asof-form"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("at");
            if (typeof value !== "string" || !value) return;
            const iso = new Date(value).toISOString();
            navigate(
              `/file/${project.slug}?${queryFor({ at: iso }).toString()}`,
            );
          }}
        >
          <label htmlFor="at">Fecha y hora:</label>
          <input
            id="at"
            name="at"
            type="datetime-local"
            defaultValue={asOfActive ? toLocalInput(at) : ""}
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
      </section>

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

      {/* Search Toolbar & Fast Suggestion Chips */}
      <section className="toolbar">
        <Form method="get" className="search-form">
          <div className="search-header">
            <label htmlFor="q">Buscar documentos</label>
            <span className="result-count">
              {files.length} resultado{files.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="search-input-group">
            <div className="search-box">
              <svg
                className="search-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="11"
                  cy="11"
                  r="7"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="m20 20-3.5-3.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <input
                id="q"
                name="q"
                defaultValue={query}
                placeholder={`ej. ${scenario.recommendedQuery}`}
              />
              {(query || status || type || timeframe || sort !== "recent") && (
                <Link
                  className="search-clear"
                  aria-label="Limpiar filtros"
                  to={`/file/${project.slug}`}
                >
                  ×
                </Link>
              )}
            </div>
            <select
              name="scope"
              defaultValue={scope}
              aria-label="Alcance de búsqueda"
            >
              <option value="project">Solo {project.name}</option>
              <option value="all">Todos los escenarios</option>
            </select>
            <select
              name="status"
              defaultValue={status}
              aria-label="Filtrar por estado"
            >
              <option value="">Todos los estados</option>
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              name="type"
              defaultValue={type}
              aria-label="Filtrar por tipo de documento"
            >
              <option value="">Todos los tipos</option>
              {Object.entries(documentTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              name="timeframe"
              defaultValue={timeframe}
              aria-label="Filtrar por fecha de actualización"
            >
              <option value="">Cualquier fecha</option>
              {Object.entries(timeframeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              name="sort"
              defaultValue={sort}
              aria-label="Ordenar documentos"
            >
              {Object.entries(sortLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button className="button search-submit" type="submit">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="11"
                  cy="11"
                  r="7"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="m20 20-3.5-3.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              Buscar
            </button>
          </div>

          {/* Quick Query Suggestion Chips */}
          <div className="search-chips" aria-label="Consultas sugeridas">
            <span className="chip-label">Consultas rápidas:</span>
            {Array.from(
              new Set([
                scenario.recommendedQuery,
                "plano vigente",
                "contrato",
                "memoria técnica",
              ]),
            ).map((chip) => (
              <Link
                key={chip}
                className="search-chip"
                to={{
                  pathname: `/file/${project.slug}`,
                  search: queryFor({
                    q: chip,
                    scope,
                    status,
                    type,
                    timeframe,
                    sort,
                  }).toString(),
                }}
              >
                {chip}
              </Link>
            ))}
          </div>

          <div
            className="search-chips timeframes"
            aria-label="Períodos rápidos"
          >
            <span className="chip-label">Actualizado:</span>
            {[
              ["", "Todo"],
              ["7d", "7 días"],
              ["30d", "30 días"],
              ["90d", "90 días"],
              ["year", "1 año"],
            ].map(([value, label]) => (
              <Link
                key={value || "all"}
                className={`search-chip ${timeframe === value ? "active" : ""}`}
                to={{
                  pathname: `/file/${project.slug}`,
                  search: queryFor({
                    q: query,
                    scope,
                    status,
                    type,
                    timeframe: value,
                    sort,
                  }).toString(),
                }}
              >
                {label}
              </Link>
            ))}
          </div>

          <small className="scope-note">
            Alcance activo:{" "}
            <strong>
              {scope === "all" ? "todos los escenarios" : project.name}
            </strong>
            {status ? ` · ${labels[status] ?? status}` : ""}
            {type ? ` · ${documentTypeLabels[type] ?? type}` : ""}
            {timeframe ? ` · ${timeframeLabels[timeframe]}` : ""}
            {sort !== "recent" ? ` · ${sortLabels[sort]}` : ""}
          </small>
        </Form>
      </section>

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
            <span className="badge-count">{files.length} archivos</span>
          </div>

          {openFindingsCount > 0 && (
            <p className="findings-summary" data-testid="findings-summary">
              ⚠ {openFindingsCount} hallazgo(s) abiertos detectados por el
              índice — requieren revisión humana en Gobernanza.
            </p>
          )}

          {/* Money Shot: Explainability Card (SYNCON Principle) */}
          {selected && (
            <div
              className="explainability-box"
              aria-label="Explicabilidad del resultado"
            >
              <div className="explain-header">
                <span className="explain-sparkle">✨</span>
                <strong>Explicabilidad del documento seleccionado</strong>
              </div>
              <p className="explain-text">
                {selected.status === "approved"
                  ? `Elegido porque pertenece a ${project.name}, cuenta con aprobación técnica vigente de jefatura de obra y está listo para ejecución.`
                  : selected.status === "superseded"
                    ? `Documento SUPERADO: Ha sido reemplazado por una revisión posterior más reciente y no debe ser ejecutado en obra.`
                    : selected.status === "pending_review"
                      ? `Sugerencia de clasificación generada por el índice. Requiere confirmación humana antes de consolidarse.`
                      : `Documento pendiente de metadatos o relación formal.`}
              </p>
              {selected.relation && (
                <div className="explain-relation">
                  <span>Relación registrada:</span>
                  <mark>{relationLabel(selected.relation)}</mark>
                  <small>({selected.relation})</small>
                </div>
              )}
            </div>
          )}

          {/* File List */}
          {asOfActive ? (
            asOf?.snapshot ? (
              <div className="file-list" data-testid="asof-view">
                {asOf.snapshot.documents.map((document) => (
                  <AsOfDocumentRow key={document.id} document={document} />
                ))}
              </div>
            ) : (
              <div
                className="empty-state"
                data-testid="asof-error"
                role="alert"
              >
                <h3>No se pudo reconstruir el estado</h3>
                <p>{asOf?.error?.message ?? "Fecha no válida."}</p>
              </div>
            )
          ) : files.length === 0 ? (
            <div className="empty-state">
              <h3>No hay resultados todavía</h3>
              <p>
                Prueba con “{scenario.recommendedQuery}” o cambia el alcance de
                búsqueda a todos los proyectos.
              </p>
            </div>
          ) : (
            <div className="file-list">
              {files.map((file) => {
                const isSelected = file.id === selected?.id;
                const ext =
                  file.extension.replace(".", "").toUpperCase() || "DOC";
                const isApproved = file.status === "approved";
                const isSuper = file.status === "superseded";

                return (
                  <article
                    className={`file-row ${isSelected ? "selected" : ""} ${isApproved ? "row-approved" : ""} ${
                      isSuper ? "row-superseded" : ""
                    }`}
                    key={file.id}
                  >
                    <div className={`file-icon ext-${ext.toLowerCase()}`}>
                      {ext}
                    </div>
                    <div className="file-main">
                      <div className="file-title">
                        <strong>{file.filename}</strong>
                        <span className={`status ${file.status}`}>
                          {labels[file.status] ?? file.status}
                        </span>
                        {(openFindingsByFile.get(file.id) ?? 0) > 0 && (
                          <span
                            className="finding-badge"
                            title="Hallazgos abiertos detectados por el índice"
                          >
                            ⚠ {openFindingsByFile.get(file.id)} hallazgo(s)
                          </span>
                        )}
                      </div>
                      <p className="file-meta">
                        <span>{documentTypeLabel(file.documentType)}</span>
                        <span>·</span>
                        <span>
                          {new Date(file.modifiedAt).toLocaleDateString(
                            "es-AR",
                          )}
                        </span>
                        {file.sizeBytes > 0 && (
                          <>
                            <span>·</span>
                            <span>
                              {(file.sizeBytes / 1024 / 1024).toFixed(1)} MB
                            </span>
                          </>
                        )}
                      </p>

                      {/* Explicit labels for Playwright e2e compatibility */}
                      {"projectName" in file && (
                        <div className="file-project-tag">
                          <small className="result-project">
                            Proyecto: {(file as any).projectName}
                          </small>
                        </div>
                      )}

                      {"explanation" in file && (
                        <small className="file-explanation">
                          {(file as any).explanation[0]}
                        </small>
                      )}
                    </div>

                    <div className="file-action-cell">
                      <Link
                        className="button secondary sm"
                        preventScrollReset
                        onClick={() => setRightPanel("evidence")}
                        to={{
                          pathname: `/file/${project.slug}`,
                          search: queryFor({
                            q: query,
                            scope,
                            status,
                            type,
                            selected: file.id,
                          }).toString(),
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
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
                        Ver evidencia
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* Lower Grid: Document Relationship Map & Interactive Graph */}
          <section className="lower-grid">
            <div className="panel relation-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">TRAZABILIDAD Y VERSIONES</p>
                  <h2>Mapa de documentos</h2>
                </div>
              </div>

              <RelationGraph
                graph={graph}
                selectedId={selected?.id}
                projectSlug={project.slug}
                preserve={{ q: query, scope, status }}
                onSelect={() => setRightPanel("evidence")}
              />

              <div
                className="relation-list"
                aria-label="Lista accesible de relaciones"
              >
                <h3 className="relation-list-title">
                  Relaciones entre documentos
                </h3>
                {graph.edges.length ? (
                  <ul className="relation-cards">
                    {graph.edges.map((edge) => {
                      const from = graph.nodes.find(
                        (node) => node.id === edge.from,
                      );
                      const to = graph.nodes.find(
                        (node) => node.id === edge.to,
                      );
                      const typeLabel = relationLabels[edge.type] ?? edge.type;
                      return (
                        <li
                          className="relation-card"
                          key={`${edge.from}-${edge.to}`}
                        >
                          <Link
                            className="relation-doc"
                            preventScrollReset
                            to={`/file/${project.slug}?${queryFor({ selected: edge.from }).toString()}`}
                          >
                            <span
                              className={`relation-icon ext-${extOf(from?.label ?? "").toLowerCase()}`}
                            >
                              {extOf(from?.label ?? "")}
                            </span>
                            <span className="relation-filename">
                              {from?.label}
                            </span>
                          </Link>
                          <span
                            className={`relation-type type-${edge.type.replaceAll(" ", "-")}`}
                          >
                            {typeLabel}
                          </span>
                          <Link
                            className="relation-doc"
                            preventScrollReset
                            to={`/file/${project.slug}?${queryFor({ selected: edge.to }).toString()}`}
                          >
                            <span
                              className={`relation-icon ext-${extOf(to?.label ?? "").toLowerCase()}`}
                            >
                              {extOf(to?.label ?? "")}
                            </span>
                            <span className="relation-filename">
                              {to?.label}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p>No hay relaciones registradas.</p>
                )}
              </div>
            </div>
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

                    {/* Version Comparison Action if superseded exists */}
                    {supersededFile && selected.status === "approved" && (
                      <button
                        type="button"
                        className="compare-toggle-button"
                        onClick={() => setShowCompare(!showCompare)}
                      >
                        {showCompare
                          ? "✕ Ocultar comparación"
                          : "⚖️ Comparar con versión anterior (Rev B superada)"}
                      </button>
                    )}

                    {showCompare && supersededFile && (
                      <div className="compare-drawer">
                        <div className="compare-col current">
                          <span className="badge-tag success">
                            VIGENTE (REV C)
                          </span>
                          <strong>{selected.filename}</strong>
                          <p>
                            Aprobado para obra ·{" "}
                            {new Date(selected.modifiedAt).toLocaleDateString(
                              "es-AR",
                            )}
                          </p>
                        </div>
                        <div className="compare-col old">
                          <span className="badge-tag danger">
                            SUPERADO (REV B)
                          </span>
                          <strong>{supersededFile.filename}</strong>
                          <p>
                            No construir con este plano · Reemplazado
                            formalmente
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="preview-card">
                      {selected.preview ? (
                        <DocumentPreview
                          fileId={selected.id}
                          preview={selected.preview}
                        />
                      ) : (
                        <div className="unavailable-preview">
                          <strong>Vista no disponible</strong>
                          <small>
                            La evidencia y los metadatos siguen disponibles.
                          </small>
                        </div>
                      )}
                    </div>

                    {/* Complete Provenance & Audit Fact Sheet */}
                    <dl className="evidence-facts">
                      <dt>Ruta en Servidor Z:\</dt>
                      <dd>
                        <code>{selected.sourcePath}</code>
                      </dd>

                      <dt>Origen</dt>
                      <dd>{sourceLabel(selected, project, scenarios)}</dd>

                      <dt>Estado autoritativo</dt>
                      <dd>
                        <span className={`status ${selected.status}`}>
                          {labels[selected.status]}
                        </span>
                      </dd>

                      <dt>Relación de versión</dt>
                      <dd>
                        {selected.relation ? (
                          <span>
                            {relationLabel(selected.relation)}{" "}
                            <em>({selected.relation})</em>
                          </span>
                        ) : (
                          "Sin relación registrada"
                        )}
                      </dd>

                      {selected.reviewer && (
                        <>
                          <dt>Aprobado por</dt>
                          <dd>
                            <strong>{selected.reviewer}</strong>
                            {selected.reviewedAt && (
                              <small>
                                {" "}
                                ·{" "}
                                {new Date(selected.reviewedAt).toLocaleString(
                                  "es-AR",
                                )}
                              </small>
                            )}
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
                    <section
                      className="relation-list"
                      aria-label="Decisiones del documento"
                    >
                      <h3>Decisiones</h3>
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
