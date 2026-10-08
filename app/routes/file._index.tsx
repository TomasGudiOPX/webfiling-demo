import { Link } from "react-router";
import {
  getHealth,
  listFindings,
  listProjectFiles,
  listProjects,
  seedFixtures,
} from "../.server/db.server";
import {
  getReviewQueueSummary,
  listRecentDecisions,
  listReviewItems,
} from "../.server/governance.server";
import { scenarioRegistry } from "../scenarios";

export function loader() {
  seedFixtures();
  const projects = listProjects();
  const reviewItems = listReviewItems({});
  const openItems = reviewItems.filter((item) => item.state !== "completed");
  const projectHealth = projects.map((project) => {
    const files = listProjectFiles(project.id);
    const openFindings = listFindings(project.id).filter(
      (finding) => finding.state === "open",
    ).length;
    const items = openItems.filter((item) => item.projectId === project.id);
    return {
      slug: project.slug,
      name: project.name,
      fileCount: files.length,
      current: files.filter((file) => file.status === "approved").length,
      superseded: files.filter((file) => file.status === "superseded").length,
      awaitingReview: files.filter((file) => file.status === "pending_review")
        .length,
      openFindings,
      critical: items.filter((item) => item.severity === "critical").length,
      pending: items.length,
    };
  });
  return {
    projects,
    health: getHealth(),
    review: getReviewQueueSummary(),
    recentDecisions: listRecentDecisions(8),
    topItems: openItems.slice(0, 6),
    projectHealth,
    openFindings: projectHealth.reduce((n, p) => n + p.openFindings, 0),
    approvedCount: projectHealth.reduce((n, p) => n + p.current, 0),
  };
}

const eventLabel: Record<string, string> = {
  approve: "Aprobó",
  return: "Devolvió",
  resolve: "Resolvió hallazgo",
  dismiss: "Descartó hallazgo",
  escalate: "Escaló",
  review_assigned: "Asignó",
  urgency_updated: "Actualizó urgencia",
  superseded: "Marcó como superado",
};

const severityLabel: Record<string, string> = {
  critical: "Crítico",
  high: "Alto",
  normal: "Normal",
  low: "Bajo",
};

function decisionLabel(eventType: string) {
  return eventLabel[eventType] ?? eventType;
}

function reviewHref(item: {
  assigneeId: string | null;
  id: string;
}) {
  const base = item.assigneeId
    ? `/file/review?view=mine&actor=${item.assigneeId}`
    : `/file/review?view=unassigned&actor=document-controller`;
  return `${base}&selected=${item.id}`;
}

export default function FileIndex({
  loaderData,
}: {
  loaderData: ReturnType<typeof loader>;
}) {
  const projectBySlug = new Map(
    loaderData.projects.map((project) => [project.slug, project]),
  );
  const healthBySlug = new Map(
    loaderData.projectHealth.map((project) => [project.slug, project]),
  );
  const { review } = loaderData;

  return (
    <main className="shell catalog-shell">
      <header className="topbar">
        <div className="brand-group">
          <Link className="brand" to="/file">
            webfiling<span className="brand-dot">·</span>
          </Link>
          <span className="badge-tag">PILOTO CONSTRUCTORA</span>
        </div>
        <div className="topbar-actions">
          <span className="server-status">
            <span className={`status-dot ${loaderData.health.status}`} />
            Servidor Z:\ (
            {loaderData.health.status === "success"
              ? "Conectado"
              : "Desconectado"}
            )
          </span>
          <Link className="back-link review-nav-link" to="/file/review">
            Cola de revisión
          </Link>
          <span className="technical">ARCHIVO DOCUMENTAL INTELIGENTE</span>
        </div>
      </header>

      {/* Hero */}
      <section className="catalog-hero">
        <div className="hero-content">
          <p className="eyebrow">CENTRO DE CONTROL DE DOCUMENTACIÓN</p>
          <h1>La obra avanza con el documento correcto</h1>
          <p className="lede">
            Cada plano vigente responde quién lo aprobó, sobre qué evidencia y
            por qué. Las excepciones se deciden antes de convertirse en riesgo
            en obra — y quedan auditadas.
          </p>
          <div className="hero-actions">
            <Link className="button" to="/file/review">
              Abrir cola de revisión
            </Link>
            <a className="button secondary" href="#obras">
              Explorar obras
            </a>
          </div>
        </div>
      </section>

      {/* Live command center */}
      <section className="command-center" aria-label="Estado operativo">
        <div className="kpi-strip">
          <Link className="kpi-card kpi-pending" to="/file/review">
            <span className="kpi-value">{review.total}</span>
            <span className="kpi-label">Pendientes de decisión</span>
            <span className="kpi-sub">
              {review.bySeverity.critical + review.bySeverity.high} críticos /
              altos
            </span>
          </Link>
          <Link className="kpi-card kpi-critical" to="/file/review">
            <span className="kpi-value">{review.bySeverity.critical}</span>
            <span className="kpi-label">Riesgos críticos</span>
            <span className="kpi-sub">Pueden detener obra</span>
          </Link>
          <Link
            className="kpi-card kpi-overdue"
            to="/file/review?view=overdue&actor=document-controller"
          >
            <span className="kpi-value">{review.overdue}</span>
            <span className="kpi-label">Vencidos</span>
            <span className="kpi-sub">SLA expirado</span>
          </Link>
          <div className="kpi-card kpi-current">
            <span className="kpi-value">{loaderData.approvedCount}</span>
            <span className="kpi-label">Documentos vigentes</span>
            <span className="kpi-sub">Cubren 3 obras</span>
          </div>
          <div className="kpi-card kpi-findings">
            <span className="kpi-value">{loaderData.openFindings}</span>
            <span className="kpi-label">Hallazgos abiertos</span>
            <span className="kpi-sub">Requieren ratificación</span>
          </div>
        </div>

        <div className="command-columns">
          <div className="command-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">DECIDIR AHORA</p>
                <h2>Lo que espera una decisión</h2>
              </div>
              <Link className="text-button" to="/file/review">
                Ver todo
              </Link>
            </div>
            {loaderData.topItems.length ? (
              <ul className="decision-queue">
                {loaderData.topItems.map((item) => (
                  <li key={item.id}>
                    <Link className="decision-item" to={reviewHref(item)}>
                      <span
                        className={`severity-badge severity-${item.severity}`}
                      >
                        {severityLabel[item.severity]}
                      </span>
                      <span className="decision-body">
                        <strong>{item.filename}</strong>
                        <small>
                          {item.projectName} ·{" "}
                          {item.targetKind === "finding"
                            ? item.findingType
                            : "Clasificación"}
                          {" · "}
                          {item.assigneeName ?? "Sin asignar"}
                        </small>
                      </span>
                      <span className="decision-due">
                        {new Date(item.dueAt).toLocaleDateString("es-AR")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No hay decisiones pendientes.</p>
            )}
          </div>

          <div className="command-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">ACTIVIDAD RECIENTE</p>
                <h2>Decisiones auditadas</h2>
              </div>
            </div>
            {loaderData.recentDecisions.length ? (
              <ul className="activity-feed">
                {loaderData.recentDecisions.map((event) => (
                  <li key={event.id}>
                    <span className="activity-dot" />
                    <div className="activity-body">
                      <p>
                        <strong>{event.actorName}</strong>{" "}
                        {decisionLabel(event.eventType)}{" "}
                        <strong>{event.filename ?? event.entityType}</strong>
                      </p>
                      <small>
                        {event.projectName ?? "Sistema"} ·{" "}
                        {new Date(event.occurredAt).toLocaleString("es-AR")}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Aún no hay decisiones registradas.</p>
            )}
          </div>
        </div>
      </section>

      {/* Projects grid */}
      <section className="project-grid" id="obras" aria-labelledby="project-title">
        <div className="section-heading catalog-section-heading">
          <div>
            <p className="eyebrow">ESCENARIOS DEL PILOTO</p>
            <h2 id="project-title">Tres historias de validación documental</h2>
          </div>
          <span className="scenario-count">
            {scenarioRegistry.length} escenarios preparados
          </span>
        </div>

        <div className="scenario-cards-container">
          {scenarioRegistry.map((scenario) => {
            const project = projectBySlug.get(scenario.slug);
            const health = healthBySlug.get(scenario.slug);
            if (!project || !health) return null;
            return (
              <Link
                className="project-card scenario-card"
                to={`/file/${scenario.slug}`}
                key={scenario.slug}
              >
                <div className="card-top">
                  <span className="scenario-badge">OBRA</span>
                  <span className="scenario-pill">
                    {scenario.files.length} documentos
                  </span>
                </div>
                <strong>{scenario.name}</strong>
                <p className="scenario-story">{scenario.story}</p>
                <div className="scenario-health">
                  <span className="health-chip health-current">
                    {health.current} vigentes
                  </span>
                  {health.pending > 0 && (
                    <span className="health-chip health-pending">
                      {health.pending} por decidir
                    </span>
                  )}
                  {health.openFindings > 0 && (
                    <span className="health-chip health-finding">
                      {health.openFindings} hallazgos
                    </span>
                  )}
                </div>
                <div className="scenario-focus">
                  <span className="focus-label">Foco:</span>{" "}
                  {scenario.dominantIssue}
                </div>
                <div className="scenario-action-row">
                  <span className="scenario-query">
                    Buscar “{scenario.recommendedQuery}”
                  </span>
                  <span className="arrow-icon">→</span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Before vs After contrast */}
      <section
        className="contrast-banner"
        aria-label="Comparación antes y después"
      >
        <div className="contrast-col before">
          <div className="contrast-tag">
            SISTEMA ACTUAL (EXPLORADOR WINDOWS)
          </div>
          <h3>Miles de subcarpetas anidadas</h3>
          <p className="contrast-desc">
            <code>
              OBRAS (Z:) \ 02 - OBRAS EN CURSO \ 305 - TSINGSHAN \ 01 - Obras en
              Curso \ 03 - C013...
            </code>
          </p>
          <ul className="contrast-list">
            <li>Solo accesible conectado al Wi-Fi de la oficina.</li>
            <li>
              Incertidumbre humana sobre si el plano es el vigente o fue
              reemplazado.
            </li>
            <li>Riesgo de reprocesos y semanas de demora en obra.</li>
          </ul>
        </div>
        <div className="contrast-divider">➔</div>
        <div className="contrast-col after">
          <div className="contrast-tag success">CON WEBFILING</div>
          <h3>Búsqueda instantánea con trazabilidad</h3>
          <p className="contrast-desc">
            Búsqueda en lenguaje natural:{" "}
            <code>"plano vigente de costa norte"</code>
          </p>
          <ul className="contrast-list">
            <li>
              Resultado directo: archivo exacto con sello de vigencia y autor.
            </li>
            <li>Soporte de caché local para consulta en obra sin señal.</li>
            <li>
              IA que asiste en clasificación + confirmación humana que garantiza
              control.
            </li>
          </ul>
        </div>
      </section>

      {/* Pilot proposal */}
      <section className="pilot-proposal-box">
        <div className="proposal-content">
          <span className="eyebrow">PROPUESTA DE PILOTO REAL</span>
          <h3>Una sola obra. Muestra real. Sin mover archivos.</h3>
          <p>
            Validemos el sistema en una obra concreta durante 2 semanas. El
            equipo en campo y oficina confirmará la vigencia en segundos
            mientras la información original permanece 100% protegida en su
            servidor.
          </p>
        </div>
        <div className="proposal-quote">
          <blockquote>
            “Quiero probarlo en una obra real y confirmar en segundos cuál es el
            documento vigente, quién lo aprobó y de dónde salió.”
          </blockquote>
        </div>
      </section>
    </main>
  );
}
