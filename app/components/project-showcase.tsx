import { Form, Link, useLoaderData, useLocation } from "react-router";
import type { browserModel } from "../.server/file-browser.server";
import { DOCUMENT_CATEGORIES } from "../types";
import { ShowcaseHeader } from "./showcase-header";
import DummyCalendar from "./dummy-calendar";
import "../styles/showcase.css";

export default function ProjectShowcase() {
  const model = useLoaderData<Awaited<ReturnType<typeof browserModel>>>();
  const searchParams = new URLSearchParams(useLocation().search);
  const panel = searchParams.get("panel");
  const preservePanel = (target: string) => panel && ["agent", "calendar"].includes(panel)
    ? `${target}${target.includes("?") ? "&" : "?"}panel=${panel}`
    : target;
  return (
    <main
      className="shell catalog-shell restored-showcase"
      data-testid="project-showcase"
    >
      <ShowcaseHeader profile={model.profile} />
      <section className="catalog-hero">
        <div className="hero-content">
          <p className="eyebrow">ARCHIVOS CONECTADOS, CONTEXTO COMPARTIDO</p>
          <h1>La obra avanza con el documento correcto</h1>
          <p className="lede">
            Encuentra, reúne y organiza los archivos de cada proyecto. Planos,
            fotos y documentos, con sus versiones y relaciones en un mismo
            espacio.
          </p>
          <div className="hero-actions">
            <a className="button" href="#obras">
              Explorar proyectos
            </a>
            <Link className="button secondary" to={preservePanel("/file?browse=1")}>
              Todos los archivos
            </Link>
          </div>
        </div>
      </section>
      <Form action="/file" method="get" className="showcase-search showcase-agent-prompt">
        <input type="hidden" name="panel" value="agent" />
        <label htmlFor="showcase-query">¿Qué necesitas hacer? Pídeselo al agente</label>
        <div>
          <input
            id="showcase-query"
            type="text"
            name="intent"
            placeholder="Ej.: Resumir los documentos de Costa Norte"
            maxLength={500}
          />
          <button className="button">Abrir agente</button>
        </div>
      </Form>
      <section
        className="project-grid"
        id="obras"
        aria-labelledby="project-title"
      >
        <div className="section-heading catalog-section-heading">
          <div>
            <p className="eyebrow">TUS PROYECTOS</p>
            <h2 id="project-title">Explora documentos por proyecto</h2>
          </div>
          <span className="scenario-count">
            {model.projects.length} proyectos accesibles
          </span>
        </div>
        <div className="scenario-cards-container">
          {model.projects.map((project) => {
            const files = model.files.filter((file) =>
              file.projects.some((p) => p.projectId === project.id),
            );
            const categories = DOCUMENT_CATEGORIES.filter((category) =>
              files.some(
                (file) => file.organization.categoryId === category.id,
              ),
            );
            return (
              <Link
                className="project-card scenario-card"
                to={preservePanel(`/file/${project.slug}`)}
                key={project.id}
              >
                <div className="card-top">
                  <span className="scenario-badge">OBRA</span>
                  <span className="scenario-pill">{files.length} archivos</span>
                </div>
                <strong>{project.name}</strong>
                <p className="scenario-story">
                  {categories.length
                    ? categories.map((c) => c.label).join(" · ")
                    : "Un espacio para reunir y organizar los documentos del proyecto."}
                </p>
                <div className="scenario-health">
                  <span className="health-chip">Archivos y carpetas</span>
                  <span className="health-chip">Versiones y vínculos</span>
                </div>
                <div className="scenario-action-row">
                  <span className="scenario-query">
                    Abrir documentos del proyecto
                  </span>
                  <span className="arrow-icon">→</span>
                </div>
              </Link>
            );
          })}
          {model.projects.length === 0 && (
            <p>
              No hay proyectos disponibles para este perfil. Puedes explorar tus
              colecciones a continuación.
            </p>
          )}
        </div>
      </section>
      <section className="showcase-collections" aria-labelledby="shared-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">MÁS ALLÁ DE LA OBRA</p>
            <h2 id="shared-title">Colecciones compartidas</h2>
          </div>
        </div>
        <div className="showcase-collection-links">
          {model.collections
            .filter((collection) => !collection.projectId)
            .map((collection) => (
              <Link
                key={collection.id}
                to={preservePanel(`/file?browse=1&collection=${encodeURIComponent(collection.id)}`)}
              >
                <strong>{collection.name}</strong>
                <span>
                  {collection.capabilities.canOrganize
                    ? "Organizar archivos"
                    : collection.capabilities.canContribute
                      ? "Consultar y aportar archivos"
                      : "Consultar archivos"}{" "}
                  →
                </span>
              </Link>
            ))}
        </div>
      </section>
      {/* Original live calendar: <CollectionCalendar collections={model.collections} /> */}
      <DummyCalendar />
    </main>
  );
}
