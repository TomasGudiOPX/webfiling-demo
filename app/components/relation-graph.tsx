import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { RelationGraph as RelationGraphData } from "../types";
import type { SearchFilters } from "../search-filters";
import { workspaceUrl } from "../search-filters";
import {
  RelationScene,
  RELATION_STYLES,
  STATUS_COLORS,
  STATUS_LABELS,
} from "./relation-scene";

export function RelationGraph({
  graph,
  selectedId,
  projectSlug,
  preserve,
  onSelect,
  fileHref,
}: {
  graph: RelationGraphData;
  selectedId?: string;
  projectSlug: string;
  preserve: Partial<SearchFilters>;
  onSelect?: () => void;
  fileHref?: (fileId: string) => string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<RelationScene | null>(null);
  const navigate = useNavigate();
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const navRef = useRef({ projectSlug, preserve, fileHref });
  navRef.current = { projectSlug, preserve, fileHref };

  const linkFor = (nodeId: string) => {
    const { projectSlug, preserve, fileHref } = navRef.current;
    return fileHref
      ? fileHref(nodeId)
      : workspaceUrl(projectSlug, preserve, nodeId);
  };

  const activate = (nodeId: string) => {
    onSelect?.();
    navigate(linkFor(nodeId), { preventScrollReset: true });
  };
  const activateRef = useRef(activate);
  activateRef.current = activate;

  const graphKey = useMemo(
    () =>
      JSON.stringify(graph.nodes) +
      "::" +
      graph.edges
        .map((edge) => `${edge.from}->${edge.to}:${edge.type}`)
        .join("|"),
    [graph],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new RelationScene(
      canvas,
      graph,
      () => ({
        selectedId: selectedRef.current ?? null,
        paused: pausedRef.current,
      }),
      (nodeId) => activateRef.current(nodeId),
    );
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, [graphKey]);

  useEffect(() => {
    sceneRef.current?.refresh();
  }, [selectedId, paused]);

  const relationTypes = useMemo(
    () => [...new Set(graph.edges.map((edge) => edge.type))],
    [graph],
  );
  const statuses = useMemo(
    () => [...new Set(graph.nodes.map((node) => node.status))],
    [graph],
  );

  return (
    <div className="relation-graph brain-graph" data-testid="relation-graph">
      <div className="brain-heading">
        <div>
          <span className="brain-kicker">RED DOCUMENTAL</span>
          <p>Los archivos, conectados</p>
        </div>
        <button
          type="button"
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
        >
          {paused ? "Reanudar animación" : "Pausar animación"}
        </button>
      </div>
      <div className="relation-scene">
        <canvas
          ref={canvasRef}
          className="relation-canvas"
          role="img"
          aria-label="Mapa cerebral de relaciones entre archivos. Seleccioná un punto naranja o un archivo en la lista para abrirlo."
        />
      </div>
      <p className="brain-hint">
        Puntos naranjas: archivos. Líneas destacadas: vínculos registrados. La
        malla tenue ilustra la forma del cerebro.
      </p>

      <svg width="0" height="0" aria-hidden="true" className="relation-defs">
        <defs>
          <marker
            id="graph-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" fill="#f87171" />
          </marker>
        </defs>
      </svg>

      <ul
        className="relation-sr-links"
        aria-label="Nodos del mapa de relaciones"
      >
        {graph.nodes.map((node) => (
          <li key={node.id}>
            <Link
              to={linkFor(node.id)}
              preventScrollReset
              onClick={onSelect}
              aria-label={`${node.label}, ${STATUS_LABELS[node.status] ?? node.status}`}
              aria-current={node.id === selectedId ? "true" : undefined}
            >
              {node.label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="graph-legend" aria-label="Leyenda del mapa de relaciones">
        {relationTypes.map((type) => {
          const style = RELATION_STYLES[type] ?? {
            color: "var(--muted)",
            label: type,
          };
          return (
            <span className="legend-item" key={type}>
              <svg width="34" height="10" aria-hidden="true">
                <line
                  x1="1"
                  y1="5"
                  x2="33"
                  y2="5"
                  stroke={style.color}
                  strokeWidth="2"
                  strokeDasharray={
                    style.dash ? style.dash.join(" ") : undefined
                  }
                  markerEnd={style.arrow ? "url(#graph-arrow)" : undefined}
                />
              </svg>
              {style.label}
            </span>
          );
        })}
        <span className="legend-separator" aria-hidden="true" />
        {statuses.map((status) => (
          <span className="legend-item" key={status}>
            <span
              className="legend-dot"
              style={{ background: STATUS_COLORS[status] ?? "var(--sage)" }}
            />
            {STATUS_LABELS[status] ?? status}
          </span>
        ))}
      </div>
    </div>
  );
}
