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

type BrainGraph = Omit<RelationGraphData, "edges"> & {
  edges: Array<{ from: string; to: string; type: string }>;
};

const CONTEXT_LINKS = [
  { key: "disciplineTag", type: "same discipline", priority: 3 },
  { key: "locationTag", type: "same location", priority: 2 },
  { key: "categoryId", type: "same category", priority: 1 },
] as const;

function connectContext(graph: RelationGraphData): BrainGraph {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edges = new Map<
    string,
    { from: string; to: string; type: string; priority: number }
  >();
  const pairKey = (from: string, to: string) =>
    JSON.stringify([from, to].sort());

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    edges.set(pairKey(edge.from, edge.to), { ...edge, priority: 4 });
  }

  for (const rule of CONTEXT_LINKS) {
    const groups = new Map<string, string[]>();
    for (const node of graph.nodes) {
      const value = node[rule.key];
      if (!value) continue;
      const group = groups.get(value);
      if (group) group.push(node.id);
      else groups.set(value, [node.id]);
    }

    for (const ids of groups.values()) {
      ids.sort();
      for (let index = 1; index < ids.length; index++) {
        const from = ids[index - 1];
        const to = ids[index];
        const key = pairKey(from, to);
        const existing = edges.get(key);
        if (!existing || existing.priority < rule.priority) {
          edges.set(key, { from, to, type: rule.type, priority: rule.priority });
        }
      }
    }
  }

  return {
    nodes: graph.nodes,
    edges: [...edges.values()].map(({ from, to, type }) => ({ from, to, type })),
  };
}

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
    const scrollY = typeof window !== "undefined" ? window.scrollY : 0;
    const scrollX = typeof window !== "undefined" ? window.scrollX : 0;
    onSelect?.();
    navigate(linkFor(nodeId), { preventScrollReset: true, replace: true });
    if (typeof window !== "undefined") {
      requestAnimationFrame(() => {
        if (window.scrollY !== scrollY) {
          window.scrollTo(scrollX, scrollY);
        }
      });
    }
  };
  const activateRef = useRef(activate);
  activateRef.current = activate;

  const brainGraph = useMemo(() => connectContext(graph), [graph]);
  const graphKey = useMemo(
    () =>
      JSON.stringify(brainGraph.nodes) +
      "::" +
      brainGraph.edges
        .map((edge) => `${edge.from}->${edge.to}:${edge.type}`)
        .join("|"),
    [brainGraph],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new RelationScene(
      canvas,
      brainGraph,
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

  const visibleEdges = brainGraph.edges;
  const relationTypes = useMemo(
    () => [...new Set(visibleEdges.map((edge) => edge.type))],
    [visibleEdges],
  );
  const statuses = useMemo(
    () => [...new Set(graph.nodes.map((node) => node.status))],
    [graph],
  );

  return (
    <div className="relation-graph brain-graph" data-testid="relation-graph">
      <div className="brain-heading">
        <div>
          <span className="brain-kicker">RED DE CONOCIMIENTO</span>
          <p>Vínculos que responden al cursor</p>
          <span className="brain-summary">
            {graph.nodes.length} archivos · {visibleEdges.length} vínculos
          </span>
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
          aria-label={`Red de conocimiento con ${graph.nodes.length} archivos y ${visibleEdges.length} vínculos. Seleccioná un nodo para abrirlo; al enfocarlo se iluminan sus conexiones.`}
        />
      </div>
      <p className="brain-hint">
        Pasá el cursor por un nodo para activar sus conexiones; hacé clic para
        abrir el archivo. Arrastrá nodos para explorar la red.
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
              replace
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
        <span className="legend-item">
          <svg width="34" height="10" aria-hidden="true">
            <line x1="1" y1="5" x2="33" y2="5" stroke="#73d8c0" strokeWidth="2" />
          </svg>
          actividad de red
        </span>
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
