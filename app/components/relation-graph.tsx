import { useEffect, useMemo, useRef, useState } from "react";
import type { RelationGraph as RelationGraphData } from "../types";
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
  onSelectFile,
  onOpenFile,
  modalOpen = false,
}: {
  graph: RelationGraphData;
  selectedId?: string;
  onSelectFile?: (fileId: string) => void;
  onOpenFile?: (fileId: string) => void;
  modalOpen?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<RelationScene | null>(null);
  const [paused, setPaused] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [groupValue, setGroupValue] = useState<string | null>(null);
  const [groupPositions, setGroupPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [groupPositionsLoaded, setGroupPositionsLoaded] = useState(false);
  const sceneContainerRef = useRef<HTMLDivElement | null>(null);
  const groupDragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressGroupClickRef = useRef(false);
  const onSelectFileRef = useRef(onSelectFile);
  onSelectFileRef.current = onSelectFile;
  const onOpenFileRef = useRef(onOpenFile);
  onOpenFileRef.current = onOpenFile;
  const sceneStateRef = useRef({ paused, focusedId, query, modalOpen, selectedId, groupValue, groupCenters: {} as Record<string, { x: number; y: number }> });

  useEffect(() => {
    try {
      const saved = localStorage.getItem("webfiling-demo:relation-group-positions");
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          setGroupPositions(Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, { x: number; y: number }] => {
            const value = entry[1] as { x?: unknown; y?: unknown };
            return typeof value?.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y);
          })));
        }
      }
    } catch {
      // Ignore invalid saved positions and keep the default layout.
    }
    setGroupPositionsLoaded(true);
  }, []);

  useEffect(() => {
    if (!groupPositionsLoaded) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem("webfiling-demo:relation-group-positions", JSON.stringify(groupPositions));
      } catch {
        // Keep dragging available when browser storage is unavailable.
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [groupPositions, groupPositionsLoaded]);

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
        selectedId: sceneStateRef.current.selectedId ?? null,
        paused: sceneStateRef.current.paused,
        focusedId: sceneStateRef.current.focusedId,
        searchQuery: sceneStateRef.current.query,
        modalOpen: sceneStateRef.current.modalOpen,
        groupBy: "projectId",
        groupValue: sceneStateRef.current.groupValue,
        groupCenters: sceneStateRef.current.groupCenters,
      }),
      (nodeId) => {
        setFocusedId(nodeId || null);
        if (nodeId) onSelectFileRef.current?.(nodeId);
      },
      (nodeId) => onOpenFileRef.current?.(nodeId),
    );
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, [graphKey]);

  useEffect(() => {
    sceneRef.current?.refresh();
  }, [selectedId, paused, focusedId, query, modalOpen, groupValue, groupPositions]);

  const visibleEdges = brainGraph.edges;
  const relationTypes = useMemo(
    () => [...new Set(visibleEdges.map((edge) => edge.type))],
    [visibleEdges],
  );
  const statuses = useMemo(
    () => [...new Set(graph.nodes.map((node) => node.status))],
    [graph],
  );
  const projectOptions = useMemo(() => {
    const projects = new Map<string, string>();
    for (const node of graph.nodes) {
      for (const project of node.projects ?? []) projects.set(project.id, project.name);
    }
    return [...projects].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [graph]);
  const groupCenters = Object.fromEntries(projectOptions.map(([id], index) => [
    id,
    groupPositions[id] ?? { x: index % 2 === 0 ? 0.24 : 0.76, y: index < 2 ? 0.28 : 0.72 },
  ]));
  sceneStateRef.current = { paused, focusedId, query, modalOpen, selectedId, groupValue, groupCenters };
  const hasProjectGroups = projectOptions.length > 0;
  const groupLabels = {
    projectId: "Obra",
    categoryId: "Categoría",
    disciplineTag: "Disciplina",
    locationTag: "Ubicación",
  } as const;
  const groupModes = (Object.keys(groupLabels) as Array<keyof typeof groupLabels>)
    .filter((key) => key !== "projectId" || hasProjectGroups);
  const nodeInGroup = (node: (typeof graph.nodes)[number], value: string) =>
    (node.projects ?? []).some((project) => project.id === value);
  const selectGroup = (value: string) => {
    setFocusedId(null);
    setGroupValue(groupValue === value ? null : value);
  };
  const moveGroupPosition = (id: string, clientX: number, clientY: number) => {
    const bounds = sceneContainerRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return;
    const canvas = canvasRef.current;
    const zoom = Number(canvas?.dataset.zoom) || 1;
    const panX = Number(canvas?.dataset.panX) || 0;
    const panY = Number(canvas?.dataset.panY) || 0;
    const worldX = ((clientX - bounds.left) - bounds.width / 2 - panX) / zoom + bounds.width / 2;
    const worldY = ((clientY - bounds.top) - bounds.height * 0.48 - panY) / zoom + bounds.height * 0.48;
    setGroupPositions((current) => ({
      ...current,
      [id]: {
        x: Math.max(0.08, Math.min(0.92, worldX / bounds.width)),
        y: Math.max(0.1, Math.min(0.9, worldY / bounds.height)),
      },
    }));
  };
  const matchingCount = graph.nodes.filter((node) =>
    node.label.toLocaleLowerCase("es").includes(query.trim().toLocaleLowerCase("es")),
  ).length;

  const resetView = () => {
    setFocusedId(null);
    sceneRef.current?.resetView();
  };

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
      <div className="relation-tools">
        <label>
          Buscar en el mapa
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Nombre del archivo"
            aria-label="Buscar archivos del gráfico"
          />
        </label>
        <button
          type="button"
          className="relation-group-reset"
          onClick={() => { setFocusedId(null); setGroupValue(null); }}
          disabled={!groupValue}
        >
          Quitar agrupación
        </button>
        <div className="relation-camera" role="group" aria-label="Controles de vista del gráfico">
          <button type="button" aria-label="Alejar gráfico" onClick={() => sceneRef.current?.zoomBy(0.8)}>−</button>
          <button type="button" aria-label="Acercar gráfico" onClick={() => sceneRef.current?.zoomBy(1.25)}>+</button>
          <button type="button" onClick={resetView}>Restablecer vista</button>
        </div>
      </div>
      {query.trim() && (
        <p className="relation-search-status" role="status">
          {matchingCount ? `${matchingCount} coincidencia(s)` : "No se encontraron archivos"}
        </p>
      )}
      <div className="relation-scene" ref={sceneContainerRef}>
        <div className="relation-obra-controls" role="group" aria-label="Agrupar archivos por obra">
          {projectOptions.map(([id, name]) => {
            const position = groupCenters[id];
            return (
              <button
                key={id}
                type="button"
                aria-pressed={groupValue === id}
                data-project-group={id}
                title="Arrastra para mover el grupo; usa las flechas para ajustarlo."
                style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  groupDragRef.current = { id, startX: event.clientX, startY: event.clientY, moved: false };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const drag = groupDragRef.current;
                  if (!drag || drag.id !== id) return;
                  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
                  drag.moved = true;
                  moveGroupPosition(id, event.clientX, event.clientY);
                }}
                onPointerUp={() => {
                  if (groupDragRef.current?.id !== id) return;
                  suppressGroupClickRef.current = groupDragRef.current.moved;
                  groupDragRef.current = null;
                }}
                onPointerCancel={() => {
                  groupDragRef.current = null;
                  suppressGroupClickRef.current = false;
                }}
                onClick={(event) => {
                  if (suppressGroupClickRef.current) {
                    suppressGroupClickRef.current = false;
                    event.preventDefault();
                    return;
                  }
                  selectGroup(id);
                }}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 0.04 : 0.015;
                  const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
                  if (!delta) return;
                  event.preventDefault();
                  const current = groupCenters[id];
                  setGroupPositions((positions) => ({
                    ...positions,
                    [id]: { x: Math.max(0.08, Math.min(0.92, current.x + delta[0])), y: Math.max(0.1, Math.min(0.9, current.y + delta[1])) },
                  }));
                }}
              >
                {name}
              </button>
            );
          })}
        </div>
        <canvas
          ref={canvasRef}
          className="relation-canvas"
          role="img"
          aria-label={`Red de conocimiento con ${graph.nodes.length} archivos y ${visibleEdges.length} vínculos. Haz clic en un nodo para seleccionarlo y doble clic para abrir su vista previa.`}
          tabIndex={0}
        />
      </div>
      <p className="brain-hint">
        Haz clic en un nodo para seleccionarlo; doble clic para abrir su vista previa. Arrastra el nombre de una obra para mover su grupo, un nodo para moverlo o el fondo para desplazar el mapa.
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
            <button
              type="button"
              onClick={(event) => {
                if (event.detail === 0) onOpenFileRef.current?.(node.id);
                else {
                  setFocusedId(node.id);
                  onSelectFileRef.current?.(node.id);
                }
              }}
              onDoubleClick={() => onOpenFileRef.current?.(node.id)}
              data-graph-file-id={node.id}
              aria-pressed={node.id === focusedId}
            >
              {node.label}
            </button>
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
