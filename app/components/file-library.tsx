import { useEffect, useRef, useState } from "react";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";
import type { browserModel, BrowserFile } from "../.server/file-browser.server";
import { DOCUMENT_CATEGORIES, DISCIPLINE_TAGS, LOCATION_TAGS } from "../types";
import { DOCUMENT_TYPE_IDS } from "../search-filters";
import { DocumentPreview } from "./document-preview";
import { RelationGraph } from "./relation-graph";
import { ShowcaseHeader } from "./showcase-header";
import "../styles/library.css";
import "../styles/showcase.css";

type Model = Awaited<ReturnType<typeof browserModel>>;
const profiles = {
  employee: "Empleado",
  manager: "Gerencia",
  "administration-staff": "Administración",
  "system-administrator": "Administrador del sistema",
};
const events: Record<string, string> = {
  uploaded: "Archivo cargado",
  metadata_changed: "Categoría o etiquetas actualizadas",
  projects_changed: "Proyectos vinculados",
  renamed: "Nombre actualizado",
  moved: "Archivo movido",
  trashed: "Enviado a la papelera",
  restored: "Archivo restaurado",
};
const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
function Choice({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string | null;
  options: Readonly<Record<string, string>>;
}) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={value ?? ""}>
        <option value="">Sin seleccionar</option>
        {Object.entries(options).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
function FolderOptions({
  model,
  collectionId,
}: {
  model: Model;
  collectionId: string;
}) {
  return (
    <>
      {model.folders
        .filter(
          (f) =>
            f.kind === "managed" &&
            f.collectionId === collectionId &&
            f.id.startsWith("managed:") &&
            f.id.slice(8).length === 36,
        )
        .map((f) => (
          <option value={f.id.slice(8)} key={f.id}>
            {f.location}
          </option>
        ))}
    </>
  );
}
function Upload({ model, close }: { model: Model; close: () => void }) {
  const destinations = model.collections.filter(
    (c) => c.capabilities.canContribute,
  );
  const [collectionId, setCollectionId] = useState(
    destinations.find((c) => c.id === model.collectionId)?.id ??
      destinations[0]?.id ??
      "",
  );
  const navigation = useNavigation();
  return (
    <section className="library-upload" aria-label="Cargar archivo">
      <header>
        <h2>Cargar archivo</h2>
        <button type="button" onClick={close} aria-label="Cerrar carga">
          Cerrar
        </button>
      </header>
      <p>
        Un archivo de hasta 20 MiB. PDF, DOCX, MD, TXT, PNG, JPEG o WebP. Se
        guarda separado de los originales del servidor.
      </p>
      <Form method="post" encType="multipart/form-data">
        <input type="hidden" name="intent" value="upload" />
        <label>
          Archivo
          <input
            required
            type="file"
            name="file"
            accept=".pdf,.docx,.md,.txt,.png,.jpg,.jpeg,.webp"
          />
        </label>
        <label>
          Colección de destino
          <select
            name="collectionId"
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
          >
            {destinations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Carpeta de destino
          <select name="folderId" key={collectionId}>
            <option value="">Raíz de archivos cargados</option>
            <FolderOptions model={model} collectionId={collectionId} />
          </select>
        </label>
        <fieldset>
          <legend>Vincular a proyectos (opcional)</legend>
          {model.projects.map((p) => (
            <label className="library-check" key={p.id}>
              <input type="checkbox" name="projectId" value={p.id} />
              {p.name}
            </label>
          ))}
        </fieldset>
        <button className="primary" disabled={navigation.state !== "idle"}>
          {navigation.state === "submitting" ? "Guardando…" : "Guardar archivo"}
        </button>
      </Form>
    </section>
  );
}
function Edit({ file, model }: { file: BrowserFile; model: Model }) {
  return (
    <details className="library-edit">
      <summary>Organizar archivo</summary>
      <Form method="post" encType="multipart/form-data">
        <input type="hidden" name="intent" value="edit" />
        <input type="hidden" name="fileId" value={file.id} />
        {file.origin === "managed_upload" && (
          <>
            <label>
              Nombre visible
              <input
                name="displayName"
                defaultValue={file.displayName}
                required
                maxLength={200}
              />
            </label>
            <label>
              Carpeta
              <select
                name="folderId"
                defaultValue={
                  file.folderId.startsWith("managed:") &&
                  file.folderId.slice(8).length === 36
                    ? file.folderId.slice(8)
                    : ""
                }
              >
                <option value="">Raíz de archivos cargados</option>
                <FolderOptions model={model} collectionId={file.collectionId} />
              </select>
            </label>
          </>
        )}
        <Choice
          name="categoryId"
          label="Categoría"
          value={file.organization.categoryId}
          options={Object.fromEntries(
            DOCUMENT_CATEGORIES.map((c) => [c.id, c.label]),
          )}
        />
        <Choice
          name="discipline"
          label="Disciplina"
          value={file.organization.tags.discipline}
          options={DISCIPLINE_TAGS}
        />
        <Choice
          name="location"
          label="Ubicación temática"
          value={file.organization.tags.location}
          options={LOCATION_TAGS}
        />
        <fieldset>
          <legend>Proyectos vinculados</legend>
          {model.projects.map((p) => (
            <label className="library-check" key={p.id}>
              <input
                type="checkbox"
                name="projectId"
                value={p.id}
                defaultChecked={file.projects.some(
                  (link) => link.projectId === p.id,
                )}
              />
              {p.name}
            </label>
          ))}
        </fieldset>
        <button className="primary">Guardar organización</button>
      </Form>
    </details>
  );
}

type FileDetailsProps = {
  current: BrowserFile;
  model: Model;
  compare: string;
  setCompare: (value: string) => void;
  href: (values: Record<string, string | null>, root?: boolean) => string;
  withActivePanel: (target: string) => string;
};

function FileDetails({
  current,
  model,
  compare,
  setCompare,
  href,
  withActivePanel,
}: FileDetailsProps) {
  return (
    <details className="library-full-details" open>
      <summary>Detalles del archivo</summary>
      <dl>
        <dt>Colección</dt>
        <dd>{current.collectionName}</dd>
        <dt>Ubicación</dt>
        <dd>{current.location}</dd>
        <dt>Nombre original</dt>
        <dd>{current.filename}</dd>
        <dt>Disponibilidad</dt>
        <dd>
          {current.availability === "available"
            ? "Contenido disponible"
            : "Contenido no disponible"}
        </dd>
      </dl>
      {current.organization.tags.discipline && (
        <span className="library-tag">
          {DISCIPLINE_TAGS[current.organization.tags.discipline]}
        </span>
      )}
      {current.organization.tags.location && (
        <span className="library-tag">
          {LOCATION_TAGS[current.organization.tags.location]}
        </span>
      )}
      <h3>Proyectos vinculados</h3>
      {current.projects.length ? (
        current.projects.map((p) => (
          <p key={p.projectId}>
            <Link
              to={withActivePanel(`/file/${model.projects.find((project) => project.id === p.projectId)?.slug}?selected=${current.id}`)}
            >
              {model.projects.find((project) => project.id === p.projectId)?.name}
            </Link>
          </p>
        ))
      ) : (
        <p>Sin proyecto asociado.</p>
      )}
      {!model.trash && (
        <>
          <h3>
            {model.latestId ? "Versiones registradas" : "Versiones disponibles"}
          </h3>
          {model.versions.length > 1 ? (
            model.versions.map((file) => (
              <p key={file.id}>
                <Link to={href({ selected: file.id })}>{file.name}</Link>
                {file.id === model.latestId && (
                  <small> · Última versión registrada</small>
                )}
              </p>
            ))
          ) : (
            <p>Sin otras versiones vinculadas.</p>
          )}
          {current.versions.supersedes.length > 0 && (
            <>
              <button
                type="button"
                onClick={() =>
                  setCompare(compare ? "" : current.versions.supersedes[0])
                }
              >
                {compare
                  ? "Cerrar comparación"
                  : "Comparar con versión anterior"}
              </button>
              {compare && (
                <section>
                  <h4>Versión anterior vinculada</h4>
                  <DocumentPreview
                    fileId={compare}
                    preview={{
                      kind: current.preview?.kind ?? "unavailable",
                      title: "Versión anterior",
                    }}
                  />
                </section>
              )}
            </>
          )}
          <h3>Archivos relacionados</h3>
          {model.related.length ? (
            model.related.map((file) => (
              <p key={file.id}>
                <Link to={href({ selected: file.id })}>{file.name}</Link>
                <small> · {file.label}</small>
              </p>
            ))
          ) : (
            <p>Sin vínculos registrados.</p>
          )}
          {current.capabilities.canEdit && <Edit file={current} model={model} />}
        </>
      )}
      {current.capabilities.canEdit &&
        current.origin === "managed_upload" && (
          <Form method="post" encType="multipart/form-data">
            <input type="hidden" name="fileId" value={current.id} />
            <input
              type="hidden"
              name="intent"
              value={model.trash ? "restore" : "trash"}
            />
            <button>
              {model.trash ? "Restaurar archivo" : "Enviar a papelera"}
            </button>
          </Form>
        )}
      <details className="library-activity">
        <summary>Actividad del archivo</summary>
        {model.activity.length ? (
          <ol>
            {model.activity.map((event) => (
              <li key={event.id}>
                <strong>{events[event.eventType] ?? "Archivo actualizado"}</strong>
                <small>
                  {profiles[event.actorId as keyof typeof profiles] ??
                    event.actorId}{" "}
                  · {new Date(event.occurredAt).toLocaleString("es-AR")}
                </small>
              </li>
            ))}
          </ol>
        ) : (
          <p>Sin actividad de archivo registrada.</p>
        )}
      </details>
    </details>
  );
}

export default function FileLibrary() {
  const model = useLoaderData<Model>();
  const action = useActionData<{ error?: string }>();
  const location = useLocation();
  const [upload, setUpload] = useState(false);
  const results = useRef<HTMLHeadingElement>(null);
  const detail = useRef<HTMLHeadingElement>(null);
  const previousSelection = useRef(model.selected?.id);
  const [compare, setCompare] = useState("");
  const [filePage, setFilePage] = useState(0);
  const [managerExpanded, setManagerExpanded] = useState(false);
  useEffect(() => {
    if (previousSelection.current !== model.selected?.id) {
      if (model.selected) detail.current?.focus({ preventScroll: true });
      else results.current?.focus({ preventScroll: true });
      previousSelection.current = model.selected?.id;
    }
    setCompare("");
    setUpload(false);
  }, [model.selected?.id, model.profile]);
  useEffect(() => {
    if (!managerExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setManagerExpanded(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [managerExpanded]);
  const href = (values: Record<string, string | null>, root = false) => {
    const params = new URLSearchParams(location.search);
    params.set("browse", "1");
    params.delete("message");
    for (const [key, value] of Object.entries(values))
      value ? params.set(key, value) : params.delete(key);
    return (
      (root ? "/file" : location.pathname) + (params.size ? "?" + params : "")
    );
  };
  const withActivePanel = (target: string) => {
    const panel = new URLSearchParams(location.search).get("panel");
    if (panel !== "agent" && panel !== "calendar" && panel !== "rules") return target;
    return `${target}${target.includes("?") ? "&" : "?"}panel=${panel}`;
  };
  const current = model.selected;
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(model.files.length / pageSize));
  const visiblePage = Math.min(filePage, pageCount - 1);
  const visibleFiles = !model.trash
    ? model.files.slice(visiblePage * pageSize, visiblePage * pageSize + pageSize)
    : model.files;
  const selectedCollection = model.collections.find(
    (c) => c.id === model.collectionId,
  );
  const children = model.folders.filter(
    (f) =>
      f.parentId === (model.folderId || null) &&
      (!model.filters.query || f.count > 0),
  );
  const breadcrumbs = [];
  let ancestor = model.folder;
  const seen = new Set<string>();
  while (ancestor && !seen.has(ancestor.id)) {
    breadcrumbs.unshift(ancestor);
    seen.add(ancestor.id);
    ancestor = model.folders.find((f) => f.id === ancestor!.parentId) ?? null;
  }
  return (
    <main
      className={`shell workspace-shell library-shell showcase-workspace ${model.project ? "has-project" : ""} ${!model.trash ? "compact-file-workspace" : ""} ${current ? "has-selection" : ""}`}
    >
      <ShowcaseHeader profile={model.profile} workspace />
      <div className="library-layout">
        <nav className="library-sidebar" aria-label="Colecciones y proyectos">
          <div className="library-sidebar-group">
            <span className="library-sidebar-label">ARCHIVO</span>
            <Link
              to={href({ selected: null, evidence: null }, true)}
              className={
                !model.collectionId && !model.project && !model.trash
                  ? "active"
                  : ""
              }
            >
              Todos los archivos
            </Link>
            <Link
              to={href(
                { trash: "1", selected: null, evidence: null, folder: null },
                true,
              )}
              className={model.trash ? "active" : ""}
            >
              Papelera
            </Link>
          </div>
          <div className="library-sidebar-group">
            <span className="library-sidebar-label">COLECCIONES</span>
            {model.collections.map((c) => (
              <Link
                key={c.id}
                to={href(
                  {
                    collection: c.id,
                    folder: null,
                    selected: null,
                    evidence: null,
                    searchScope: null,
                    scope: null,
                    trash: null,
                  },
                  true,
                )}
                className={c.id === model.collectionId ? "active" : ""}
              >
                {c.name}
                <small>
                  {c.capabilities.canOrganize
                    ? "Organizar"
                    : c.capabilities.canContribute
                      ? "Aportar archivos"
                      : "Solo lectura"}
                </small>
              </Link>
            ))}
          </div>
          <details className="library-sidebar-group library-sidebar-projects">
            <summary>
              Proyectos vinculados <span>{model.projects.length}</span>
            </summary>
            <div className="library-sidebar-links">
              {model.projects.map((p) => (
                <Link
                  key={p.id}
                  to={withActivePanel(`/file/${p.slug}`)}
                  className={p.id === model.project?.id ? "active" : ""}
                >
                  {p.name}
                </Link>
              ))}
            </div>
          </details>
          <div className="library-sidebar-group library-demo-group">
            <span className="library-sidebar-label">PRUEBA · MUESTRA</span>
            {model.profile === "system-administrator" && (
              <details>
                <summary>Datos de ejemplo</summary>
                <p>Restablecer ejemplos conserva las cargas reales.</p>
                <Form method="post" encType="multipart/form-data">
                  <input type="hidden" name="intent" value="reset" />
                  <button>Restablecer ejemplos</button>
                </Form>
              </details>
            )}
          </div>
        </nav>
        <section className="library-main">
          <header className="library-title project-heading">
            <div>
              <p className="eyebrow">
                {model.project
                  ? "ESPACIO DE OBRA / DOCUMENTOS"
                  : "ARCHIVO DOCUMENTAL / COLECCIONES"}
              </p>
              <h1>
                {model.trash
                  ? "Papelera"
                  : (model.project?.name ??
                    selectedCollection?.name ??
                    "Todos los archivos")}
              </h1>
              <p className="project-subtitle">
                Archivos, versiones y relaciones · Originales del servidor
                protegidos
              </p>
            </div>
            {!model.trash &&
              model.collections.some((c) => c.capabilities.canContribute) && (
                <button
                  className="primary"
                  onClick={() => setUpload((v) => !v)}
                >
                  Cargar archivo
                </button>
              )}
          </header>

          {!model.trash && (
            <details className="operations-brain showcase-map" open>
              <summary>Cerebro de operaciones</summary>
              <div className="panel relation-panel">
                <RelationGraph
                  graph={model.graph}
                  selectedId={current?.id}
                  projectSlug={model.project?.slug ?? model.projects[0]?.slug ?? "files"}
                  preserve={model.filters}
                  fileHref={(id) => href({ selected: id, evidence: null })}
                />
              </div>
            </details>
          )}
          {model.retired && (
            <div className="library-notice" role="status">
              Los filtros y enlaces del antiguo flujo ya no están disponibles.{" "}
              <Link to="/file">Volver a los archivos actuales</Link>
            </div>
          )}
          {action?.error && (
            <p className="library-error" role="alert">
              {action.error}
            </p>
          )}
          {new URLSearchParams(location.search).get("message") && (
            <p className="library-notice" role="status">
              {new URLSearchParams(location.search).get("message")}
            </p>
          )}
          {upload && <Upload model={model} close={() => setUpload(false)} />}

          {model.invalid.length > 0 && (
            <p role="status">
              Algunos filtros no son válidos.{" "}
              <Link to="/file?browse=1">Restablecer filtros</Link>
            </p>
          )}
          {breadcrumbs.length > 0 && (
            <nav className="library-breadcrumbs" aria-label="Ruta de carpetas">
              {breadcrumbs.map((f, index) => (
                <span key={f.id}>
                  {index > 0 && " / "}
                  <Link
                    to={href({
                      folder: f.id,
                      collection: f.collectionId,
                      searchScope: null,
                      scope: null,
                      selected: null,
                      evidence: null,
                    })}
                  >
                    {f.name}
                  </Link>
                </span>
              ))}
            </nav>
          )}
          <div className="library-content">
            {!model.trash && managerExpanded && (
              <div
                className="preview-backdrop"
                role="presentation"
                onMouseDown={() => setManagerExpanded(false)}
              />
            )}
            <section
              className={`library-results ${!model.trash ? "project-file-manager" : ""} ${managerExpanded ? "is-expanded preview-dialog" : ""}`}
              aria-label={model.project ? "Archivos del proyecto" : "Administrador de archivos"}
              role={managerExpanded ? "dialog" : undefined}
              aria-modal={managerExpanded ? "true" : undefined}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header>
                <h2 ref={results} tabIndex={-1}>
                  {model.project ? "Archivos del proyecto" : "Archivos"}
                </h2>
                <span className="project-file-count">{model.count} archivos</span>
                {!model.trash && (
                  <button
                    type="button"
                    className="file-manager-expand"
                    aria-label={
                      managerExpanded ? "Cerrar vista ampliada" : "Ampliar vista"
                    }
                    title={managerExpanded ? "Cerrar vista ampliada" : "Ampliar vista"}
                    onClick={() => setManagerExpanded((expanded) => !expanded)}
                    autoFocus={managerExpanded}
                  >
                    {managerExpanded ? (
                      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                        <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                      </svg>
                    )}
                  </button>
                )}
              </header>
              {(model.trash || managerExpanded) && model.view === "folders" && (
                <nav
                  className="library-folders"
                  aria-label="Carpetas disponibles"
                >
                  {children.map((f) => (
                    <Link
                      key={f.id}
                      to={href({
                        folder: f.id,
                        collection: f.collectionId,
                        searchScope: null,
                        scope: null,
                        selected: null,
                        evidence: null,
                      })}
                    >
                      <span aria-hidden="true">▱</span>
                      <span>
                        {f.name}
                        <small>
                          {
                            model.collections.find(
                              (c) => c.id === f.collectionId,
                            )?.name
                          }
                        </small>
                      </span>
                      <small>{f.count}</small>
                    </Link>
                  ))}
                </nav>
              )}
              {model.trash && selectedCollection?.capabilities.canOrganize && (
                <details className="library-new-folder">
                  <summary>Nueva carpeta</summary>
                  <Form method="post" encType="multipart/form-data">
                    <input type="hidden" name="intent" value="folder" />
                    <input
                      type="hidden"
                      name="collectionId"
                      value={selectedCollection.id}
                    />
                    <input
                      type="hidden"
                      name="parentId"
                      value={
                        model.folderId.startsWith("managed:") &&
                        model.folderId.slice(8).length === 36
                          ? model.folderId.slice(8)
                          : ""
                      }
                    />
                    <label>
                      Nombre de carpeta
                      <input name="name" required maxLength={200} />
                    </label>
                    <button>Crear carpeta</button>
                  </Form>
                </details>
              )}
              {!model.files.length && (
                <div className="library-empty">
                  <h3>No hay archivos en esta selección</h3>
                  <p>
                    Se aplican el perfil {profiles[model.profile]}, la colección
                    o carpeta y los filtros actuales.
                  </p>
                  <Link
                    to={href(
                      {
                        q: null,
                        category: null,
                        discipline: null,
                        location: null,
                        type: null,
                        timeframe: null,
                        folder: null,
                        collection: null,
                        searchScope: "all",
                        selected: null,
                        evidence: null,
                      },
                      true,
                    )}
                  >
                    Limpiar restricciones de búsqueda
                  </Link>
                </div>
              )}
              <div
                className={`library-files ${!model.trash && !managerExpanded ? "view-list" : `view-${model.view}`}`}
                style={
                  !model.trash && !managerExpanded
                    ? {
                        gridTemplateColumns: `repeat(${Math.max(1, Math.ceil(visibleFiles.length / 2))}, minmax(160px, 1fr))`,
                      }
                    : undefined
                }
              >
                {visibleFiles.map((file) => (
                  <Link
                    data-file-id={file.id}
                    key={file.id}
                    to={href({ selected: file.id, evidence: null })}
                    className={`library-file ${current?.id === file.id ? "selected" : ""}`}
                    aria-current={current?.id === file.id ? "true" : undefined}
                  >
                    <span className="library-file-icon" aria-hidden="true">
                      {file.extension.replace(".", "").toUpperCase() || "FILE"}
                    </span>
                    <span className="library-file-info">
                      <strong>{file.displayName}</strong>
                      <small>
                        {DOCUMENT_CATEGORIES.find(
                          (c) => c.id === file.organization.categoryId,
                        )?.label ?? "Sin clasificar"}{" "}
                        · {file.collectionName}
                      </small>
                      <small>{file.location}</small>
                    </span>
                    <span className="library-file-meta">
                      <time dateTime={file.modifiedAt}>
                        {new Date(file.modifiedAt).toLocaleDateString("es-AR")}
                      </time>
                      <small>
                        {size(file.sizeBytes)}
                        {file.availability !== "available"
                          ? " · No disponible"
                          : ""}
                      </small>
                    </span>
                  </Link>
                ))}
              </div>
              {!model.trash && (
                <nav className="project-file-pagination" aria-label="Páginas de archivos">
                  <button type="button" onClick={() => setFilePage((page) => Math.max(0, page - 1))} disabled={visiblePage === 0}>Anterior</button>
                  <span>Página {visiblePage + 1} de {pageCount}</span>
                  <button type="button" onClick={() => setFilePage((page) => Math.min(pageCount - 1, page + 1))} disabled={visiblePage >= pageCount - 1}>Siguiente</button>
                </nav>
              )}
              {(model.trash || managerExpanded) && (
              <details className="project-file-controls" open={!model.trash}>
                <summary>Buscar / cambiar tipo de archivo</summary>
                <Form method="get" className="project-file-search" key={JSON.stringify(model.filters)}>
                  <input type="hidden" name="browse" value="1" />
                  {new URLSearchParams(location.search).get("panel") && <input type="hidden" name="panel" value={new URLSearchParams(location.search).get("panel")!} />}
                  <input type="hidden" name="view" value={model.view} />
                  {model.collectionId && <input type="hidden" name="collection" value={model.collectionId} />}
                  {model.folderId && <input type="hidden" name="folder" value={model.folderId} />}
                  {model.trash && <input type="hidden" name="trash" value="1" />}
                  {current && <input type="hidden" name="selected" value={current.id} />}
                  {!model.trash && managerExpanded && (
                    <nav className="project-file-views" aria-label="Tipo de vista">
                      {([
                        ["list", "Lista"],
                        ["grid", "Cuadrícula"],
                        ["folders", "Carpetas"],
                      ] as const).map(([view, label]) => (
                        <Link
                          key={view}
                          to={href({ view })}
                          aria-current={model.view === view ? "page" : undefined}
                        >
                          {label}
                        </Link>
                      ))}
                    </nav>
                  )}
                  <label>
                    Buscar archivos
                    <input type="search" name="q" defaultValue={model.filters.query} placeholder="Nombre, contenido o ubicación…" />
                  </label>
                  <Choice
                    name="type"
                    label="Tipo documental"
                    value={model.filters.type}
                    options={Object.fromEntries(DOCUMENT_TYPE_IDS.map((id) => [id, id]))}
                  />
                  <Choice
                    name="category"
                    label="Categoría"
                    value={model.filters.category}
                    options={{
                      unclassified: "Sin clasificar",
                      ...Object.fromEntries(DOCUMENT_CATEGORIES.map((c) => [c.id, c.label])),
                    }}
                  />
                  <details className="library-filters project-advanced-filters">
                    <summary>Filtros avanzados</summary>
                    <div>
                      <Choice name="discipline" label="Disciplina" value={model.filters.discipline} options={DISCIPLINE_TAGS} />
                      <Choice name="location" label="Ubicación temática" value={model.filters.location} options={LOCATION_TAGS} />
                      <Choice name="timeframe" label="Modificado" value={model.filters.timeframe} options={{ "7d": "Últimos 7 días", "30d": "Últimos 30 días", "90d": "Últimos 90 días", year: "Último año" }} />
                      <label>Orden<select name="sort" defaultValue={model.filters.sort}><option value="recent">Más recientes</option><option value="oldest">Más antiguos</option><option value="name">Nombre</option></select></label>
                    </div>
                  </details>
                  <button className="primary">Buscar</button>
                </Form>
              </details>
              )}
            </section>
            {!current && !model.trash && (
              <aside
                className="showcase-preview-placeholder"
                aria-label="Vista previa"
              >
                <p className="eyebrow">DOCUMENTO Y CONTEXTO</p>
                <h2>
                  Todo sobre un archivo,
                  <br />
                  en el mismo lugar.
                </h2>
                <p>
                  Selecciona un documento para ver su contenido, ubicación,
                  etiquetas, versiones y archivos relacionados.
                </p>
                <span className="showcase-preview-mark" aria-hidden="true">
                  ↗
                </span>
              </aside>
            )}
            {current && (
              <aside
                className="library-detail"
                aria-label="Detalles del archivo"
                key={`${model.profile}:${current.id}`}
              >
                <h2 tabIndex={-1} ref={detail}>
                  {current.displayName}
                </h2>
                <p>
                  {current.origin === "source"
                    ? "Servidor · solo lectura"
                    : current.origin === "managed_upload"
                      ? "Archivo cargado"
                      : current.origin === "fixture"
                        ? ""
                        : "Sin contenido almacenado"}
                </p>
                {!model.trash && (
                  <>
                    {current.preview ? (
                      <DocumentPreview
                        fileId={current.id}
                        preview={current.preview}
                        downloadUrl={`/api/files/${current.id}/download`}
                        details={
                          <FileDetails
                            current={current}
                            model={model}
                            compare={compare}
                            setCompare={setCompare}
                            href={href}
                            withActivePanel={withActivePanel}
                          />
                        }
                      />
                    ) : (
                      <DocumentPreview
                        fileId={current.id}
                        preview={{
                          kind: "unavailable",
                          title: current.displayName,
                          reason: "Este formato no tiene vista previa. Puede descargar el archivo.",
                        }}
                        downloadUrl={`/api/files/${current.id}/download`}
                        details={
                          <FileDetails
                            current={current}
                            model={model}
                            compare={compare}
                            setCompare={setCompare}
                            href={href}
                            withActivePanel={withActivePanel}
                          />
                        }
                      />
                    )}
                  </>
                )}

                {model.trash && (
                  <FileDetails
                    current={current}
                    model={model}
                    compare={compare}
                    setCompare={setCompare}
                    href={href}
                    withActivePanel={withActivePanel}
                  />
                )}
              </aside>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
