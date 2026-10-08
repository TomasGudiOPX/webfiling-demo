import { Form, Link, useSearchParams } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { seedFixtures } from "../.server/db.server";
import {
  assignReviewItem,
  decideReviewItem,
  demoIdentities,
  getReviewEvidence,
  listReviewItems,
  updateReviewUrgency,
} from "../.server/governance.server";

const views = ["mine", "unassigned", "overdue", "completed"] as const;
const label: Record<string, string> = {
  mine: "Mi cola",
  unassigned: "Sin asignar",
  overdue: "Vencidos",
  completed: "Completados",
};
export function loader({ request }: LoaderFunctionArgs) {
  seedFixtures();
  const url = new URL(request.url);
  const actorId = url.searchParams.get("actor") ?? demoIdentities[0].id;
  const view = views.includes(url.searchParams.get("view") as any)
    ? url.searchParams.get("view")!
    : "mine";
  const selectedId = url.searchParams.get("selected") ?? "";
  return {
    actorId,
    view,
    identities: demoIdentities,
    items: listReviewItems({ view, assigneeId: actorId }),
    selected: selectedId ? getReviewEvidence(selectedId) : null,
  };
}
export async function action({ request }: ActionFunctionArgs) {
  seedFixtures();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("reviewItemId") ?? "");
  const actorId = String(form.get("actorId") ?? "");
  try {
    if (intent === "assign") {
      const assigneeId = String(form.get("assigneeId"));
      const assignee = demoIdentities.find((item) => item.id === assigneeId);
      if (!assignee) throw new Error("Invalid demo identity or role.");
      assignReviewItem(id, actorId, assigneeId, assignee.role);
    }
    if (intent === "urgency")
      updateReviewUrgency(id, actorId, {
        severity: String(form.get("severity")) as any,
        priority: String(form.get("priority")) as any,
        dueAt: String(form.get("dueAt")),
      });
    if (intent === "decision")
      decideReviewItem(
        id,
        actorId,
        String(form.get("decision")) as any,
        String(form.get("reason") ?? ""),
      );
    return { success: true };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "No se pudo actualizar la revisión.",
    };
  }
}
function href(values: Record<string, string>) {
  return `/file/review?${new URLSearchParams(values)}`;
}
export default function ReviewInbox({
  loaderData,
  actionData,
}: {
  loaderData: ReturnType<typeof loader>;
  actionData?: { error?: string };
}) {
  const [params] = useSearchParams();
  const { actorId, view, identities, items, selected } = loaderData;
  const actor = identities.find((item) => item.id === actorId) ?? identities[0];
  return (
    <main className="shell workspace-shell">
      <header className="topbar">
        <div className="brand-group">
          <Link className="brand" to="/file">
            webfiling<span className="brand-dot">·</span>
          </Link>
          <span className="badge-tag">GOBERNANZA</span>
        </div>
        <div className="topbar-actions">
          <span className="index-state">● COLA DE REVISIÓN</span>
          <Link className="back-link" to="/file">
            ← Volver a Obras
          </Link>
        </div>
      </header>
      <section className="project-heading">
        <div>
          <p className="eyebrow">GOBERNANZA / COLA DE REVISIÓN</p>
          <h1>Decisiones pendientes</h1>
          <p className="project-subtitle">
            Revisa excepciones y clasificaciones antes de que impacten en obra.
          </p>
        </div>
        <Form method="get" className="identity-picker">
          <input type="hidden" name="view" value={view} />
            <label htmlFor="actor">Revisor</label>
          <select
            id="actor"
            name="actor"
            defaultValue={actorId}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
            {identities.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.role}
              </option>
            ))}
            </select>
            <small>Identidad simulada: {actor.name} · {actor.role}</small>
        </Form>
      </section>
      <nav className="scenario-selector" aria-label="Vistas de revisión">
        {views.map((item) => (
          <Link
            key={item}
            className={view === item ? "scenario-link active" : "scenario-link"}
            aria-current={view === item ? "page" : undefined}
            to={href({ view: item, actor: actorId })}
          >
            {label[item]}
          </Link>
        ))}
      </nav>
      {actionData?.error && (
        <p className="findings-summary" role="alert">
          {actionData.error}
        </p>
      )}
      <section className="workspace-grid">
        <div className="workspace-main">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{label[view].toUpperCase()}</p>
              <h2>{items.length} elemento(s) de revisión</h2>
            </div>
          </div>
          <div className="file-list">
            {items.map((item) => (
              <article className="file-row" key={item.id}>
                <div className="file-icon">{item.severity.toUpperCase()}</div>
                <div className="file-main">
                  <div className="file-title">
                    <strong>{item.filename}</strong>
                    <span
                      className={`status ${item.state === "completed" ? "approved" : "pending_review"}`}
                    >
                      {item.state}
                    </span>
                  </div>
                  <p className="file-meta">
                    <span>{item.projectName}</span>
                    <span>·</span>
                    <span>
                      {item.targetKind === "finding"
                        ? item.findingType
                        : "Clasificación"}
                    </span>
                    <span>·</span>
                    <span>
                      {item.severity} / {item.priority}
                    </span>
                  </p>
                  <small>
                    Responsable: {item.assigneeName ?? "Sin asignar"} · vence{" "}
                    {new Date(item.dueAt).toLocaleString("es-AR")}
                  </small>
                </div>
                <Link
                  className="button secondary sm"
                  to={href({ view, actor: actorId, selected: item.id })}
                >
                  Ver evidencia
                </Link>
              </article>
            ))}
          </div>
        </div>
        {selected && (
          <aside className="evidence" aria-label="Paquete de evidencia">
            <div className="section-heading">
              <div>
                <p className="eyebrow">DECISIÓN</p>
                <h2>{selected.file.filename}</h2>
              </div>
              <Link className="close" to={href({ view, actor: actorId })}>
                Cerrar
              </Link>
            </div>
            <dl className="evidence-facts">
              <dt>Ruta</dt>
              <dd>
                <code>{selected.file.sourcePath}</code>
              </dd>
              <dt>Estado</dt>
              <dd>{selected.file.status}</dd>
              <dt>Hallazgo</dt>
              <dd>
                {selected.finding
                  ? `${selected.finding.reason} (${Math.round(selected.finding.confidence * 100)}%)`
                  : "Clasificación pendiente"}
              </dd>
              <dt>Relaciones</dt>
              <dd>
                {selected.relations
                  .map(
                    (relation) =>
                      `${relation.from} ${relation.type} ${relation.to}`,
                  )
                  .join(" · ") || "Sin relaciones"}
              </dd>
            </dl>
            <Form method="post" className="review-form">
              <input
                type="hidden"
                name="reviewItemId"
                value={selected.item.id}
              />
              <input type="hidden" name="actorId" value={actorId} />
              <label htmlFor="assigneeId">Asignar a</label>
              <select
                id="assigneeId"
                name="assigneeId"
                defaultValue={selected.item.assigneeId ?? actorId}
              >
                {identities.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <button className="button secondary" name="intent" value="assign">
                Asignar
              </button>
              <label htmlFor="severity">Urgencia</label>
              <select
                id="severity"
                name="severity"
                defaultValue={selected.item.severity}
              >
                {["critical", "high", "normal", "low"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <input
                type="hidden"
                name="priority"
                value={selected.item.priority}
              />
              <input type="hidden" name="dueAt" value={selected.item.dueAt} />
              <button
                className="button secondary"
                name="intent"
                value="urgency"
              >
                Actualizar urgencia
              </button>
              <label htmlFor="reason">
                Motivo (obligatorio para devolver, descartar o escalar)
              </label>
              <textarea
                id="reason"
                name="reason"
                placeholder="Deja la evidencia para el siguiente revisor"
              />
              {selected.item.targetKind === "file_classification" ? (
                <>
                  <button className="button" name="decision" value="approve">
                    Aprobar clasificación
                  </button>
                  <button className="button secondary" name="decision" value="return">
                    Devolver a revisión
                  </button>
                </>
              ) : (
                <>
                  <button className="button" name="decision" value="resolve">
                    Resolver hallazgo
                  </button>
                  <button className="button secondary" name="decision" value="dismiss">
                    Descartar hallazgo
                  </button>
                </>
              )}
              <button className="button secondary" name="decision" value="escalate">
                Escalar
              </button>
              <input type="hidden" name="intent" value="decision" />
            </Form>
            <section className="relation-list">
              <h3>Historial de decisiones</h3>
              {selected.timeline.length ? (
                selected.timeline.map((event) => (
                  <p key={event.id}>
                    <strong>{event.eventType}</strong> · {event.actorName} ·{" "}
                    {new Date(event.occurredAt).toLocaleString("es-AR")}
                  </p>
                ))
              ) : (
                <p>Aún no se registró una decisión final.</p>
              )}
            </section>
          </aside>
        )}
      </section>
    </main>
  );
}
