import type { RelationGraph } from "../types";
import { brainFilePositions } from "./brain-geometry";

export const STATUS_COLORS: Record<string, string> = {
  available: "#10b981",
  unavailable: "#8e9a8e",
  processing: "#38bdf8",
  error: "#f87171",
  approved: "#10b981",
  pending_review: "#f59e0b",
  pending_ingestion: "#38bdf8",
  superseded: "#f87171",
  returned: "#f87171",
  missing_metadata: "#93c5fd",
};

export const STATUS_LABELS: Record<string, string> = {
  available: "Contenido disponible",
  unavailable: "Contenido no disponible",
  processing: "Procesando archivo",
  error: "Error de archivo",
  approved: "Vigente",
  pending_review: "Pendiente de revisión",
  pending_ingestion: "Pendiente de ingestión",
  superseded: "Superado",
  returned: "Devuelto",
  missing_metadata: "Faltan datos",
};

export interface RelationStyle {
  color: string;
  dash?: number[];
  arrow?: boolean;
  label: string;
}

export const RELATION_STYLES: Record<string, RelationStyle> = {
  supersedes: { color: "#f87171", arrow: true, label: "reemplaza" },
  "related to": { color: "#c0cbaa", label: "relacionado con" },
  "awaiting confirmation": {
    color: "#f59e0b",
    label: "vínculo sugerido",
  },
  "same discipline": {
    color: "#61d7bd",
    label: "misma disciplina",
  },
  "same location": {
    color: "#8ea9ff",
    label: "misma ubicación",
  },
  "same category": {
    color: "#a7bd8d",
    label: "misma categoría",
  },
};

const TEXT_DIM = "#bac5ba";
const BG = "#0b0d0c";
const MUTED = "#8e9a8e";

type Point2D = { x: number; y: number };

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toUpperCase() : "DOC";
}

function getExtColor(ext: string): string {
  switch (ext) {
    case "PDF":
      return "#ef4444";
    case "DOCX":
    case "DOC":
      return "#3b82f6";
    case "MD":
    case "TXT":
      return "#f59e0b";
    case "JPG":
    case "JPEG":
    case "PNG":
      return "#a855f7";
    default:
      return "#10b981";
  }
}

interface SceneNode {
  id: string;
  label: string;
  status: string;
  nx: number;
  ny: number;
  nz: number;
  ox: number;
  oy: number;
  ext: string;
}

interface SceneEdge {
  from: string;
  to: string;
  type: string;
}

type SceneGraph = Omit<RelationGraph, "edges"> & { edges: SceneEdge[] };

interface ProjectedNode {
  id: string;
  x: number;
  y: number;
  depth: number;
  radius: number;
  ext: string;
}

interface SceneState {
  selectedId: string | null;
  paused?: boolean;
}

function quadPoint(from: Point2D, ctrl: Point2D, to: Point2D, t: number): Point2D {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y,
  };
}

/**
 * An authentic 3D biological & neural brain relationship canvas.
 * Renders the cerebral hemispheres, anatomical lobes, gyri/sulci folds,
 * cerebellar folia, brainstem trunk, and active synaptic connectome.
 */
export class RelationScene {
  private readonly context: CanvasRenderingContext2D;
  private readonly nodes: SceneNode[];
  private readonly edges: SceneEdge[];
  private readonly neuralEdges: Array<[string, string]>;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly reduceMotion: MediaQueryList;
  private width = 0;
  private height = 0;
  private frame = 0;
  private visible = false;
  private disposed = false;
  private animating = false;
  private elapsed = 0;
  private last = 0;
  private tiltX = 0;
  private tiltY = 0;
  private targetTiltX = 0;
  private targetTiltY = 0;
  private projected: ProjectedNode[] = [];
  private dragNodeId: string | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartOffset = { x: 0, y: 0 };
  private moved = false;
  private hoveredNodeId: string | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly graph: SceneGraph,
    private readonly state: () => SceneState,
    private readonly onSelect: (nodeId: string) => void,
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.context = context;

    const positions = brainFilePositions(
      graph.nodes.map((node) => ({
        id: node.id,
        categoryId: node.categoryId,
        disciplineTag: node.disciplineTag,
        locationTag: node.locationTag,
      })),
    );
    this.nodes = graph.nodes.map((node) => {
      const p = positions.get(node.id) ?? { x: 0, y: 0, z: 0.2 };
      return {
        id: node.id,
        label: node.label,
        status: node.status,
        nx: p.x,
        ny: p.y,
        nz: p.z,
        ox: 0,
        oy: 0,
        ext: getFileExtension(node.label),
      };
    });
    this.edges = graph.edges.filter(
      (edge) => positions.has(edge.from) && positions.has(edge.to),
    );
    this.neuralEdges = this.buildNeuralEdges(this.nodes.map((node) => node.id));

    this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    this.resizeObserver = new ResizeObserver(() => {
      this.width = canvas.clientWidth;
      this.height = canvas.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(this.width * ratio);
      canvas.height = Math.round(this.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      this.refresh();
    });
    this.resizeObserver.observe(canvas);

    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.refresh();
    });
    this.intersectionObserver.observe(canvas);

    document.addEventListener("visibilitychange", this.refresh);
    this.reduceMotion.addEventListener("change", this.refresh);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.refresh();
  }

  private running() {
    return (
      !this.state().paused &&
      !this.reduceMotion.matches &&
      this.visible &&
      !document.hidden
    );
  }

  readonly refresh = () => {
    if (this.disposed) return;
    const running = this.running();
    this.animating = running;
    if (!running) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.last = 0;
    }
    this.draw();
    if (running && !this.frame) this.frame = requestAnimationFrame(this.tick);
  };

  private readonly tick = (time: number) => {
    this.frame = 0;
    if (this.disposed || !this.running()) {
      this.last = 0;
      return;
    }
    const delta = this.last ? Math.min(time - this.last, 50) : 0;
    this.last = time;
    this.elapsed += delta;
    this.tiltX += (this.targetTiltX - this.tiltX) * Math.min(delta / 160, 1);
    this.tiltY += (this.targetTiltY - this.tiltY) * Math.min(delta / 160, 1);
    this.draw();
    this.frame = requestAnimationFrame(this.tick);
  };

  private draw() {
    if (!this.width || !this.height) return;
    const ctx = this.context;
    const { selectedId } = this.state();
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.48;
    const scaleX = Math.min(w * 0.48, h * 0.78);
    const scaleY = Math.min(h * 0.6, w * 0.46);

    const angle = 0.16 + 0.10 * Math.sin(this.elapsed * 0.00018) + this.tiltX;
    const pitch = Math.sin(this.elapsed * 0.00036) * 0.12 + this.tiltY;
    const breathing = 1 + Math.sin(this.elapsed * 0.0017) * 0.022;

    // Document nodes float across the whole network field.
    this.projected = this.nodes.map((node) => {
      const drift = Math.sin(this.elapsed * 0.0011 + node.nz * 8) * 0.004;
      const driftY = Math.cos(this.elapsed * 0.0013 + node.nz * 6) * 0.004;
      const x = node.nx * breathing + drift;
      const y = node.ny * breathing + driftY;
      const z = node.nz;
      const rx = x * Math.cos(angle) + z * Math.sin(angle);
      const rz = -x * Math.sin(angle) + z * Math.cos(angle);
      const ry = y * Math.cos(pitch) - rz * Math.sin(pitch);
      const z2 = y * Math.sin(pitch) + rz * Math.cos(pitch);
      const perspective = 2.8 / (2.8 - z2 * 0.38);
      const depth = Math.max(0, Math.min(1, (z2 + 1) / 2));
      return {
        id: node.id,
        x: cx + rx * scaleX * perspective + node.ox,
        y: cy + ry * scaleY * perspective + node.oy,
        depth,
        radius: 6 + depth * 3.5,
        ext: node.ext,
      };
    });
    const byId = new Map(this.projected.map((p) => [p.id, p]));

    const selectedConnected = selectedId
      ? this.computeConnected(selectedId)
      : new Set<string>();
    const hoveredConnected = this.hoveredNodeId
      ? this.computeConnected(this.hoveredNodeId)
      : new Set<string>();
    const hasFocus = Boolean(selectedId || this.hoveredNodeId);
    const connected = hasFocus
      ? new Set([...selectedConnected, ...hoveredConnected])
      : null;
    const activeNodes = connected ?? new Set<string>();
    if (!connected) {
      for (const edge of this.edges) {
        activeNodes.add(edge.from);
        activeNodes.add(edge.to);
      }
    }

    // Quiet neural paths span the field; hovering a node wakes its local network.
    this.neuralEdges.forEach(([from, to], index) => {
      const a = byId.get(from);
      const b = byId.get(to);
      if (!a || !b) return;
      const selectedPath = Boolean(selectedId && (from === selectedId || to === selectedId));
      const hoveredPath = Boolean(this.hoveredNodeId && (from === this.hoveredNodeId || to === this.hoveredNodeId));
      const isActive = selectedPath || hoveredPath;
      const alpha = selectedPath ? 0.64 : hoveredPath ? 0.4 : hasFocus ? 0.24 : 0.3;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const curve = index % 2 === 0 ? 18 : -18;
      const ctrl = {
        x: midX + (-dy / length) * curve,
        y: midY + (dx / length) * curve,
      };
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = "#73d8c0";
      ctx.lineWidth = selectedPath ? 1.55 : hoveredPath ? 1.25 : 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(ctrl.x, ctrl.y, b.x, b.y);
      ctx.stroke();
      if (this.animating && (isActive || !hasFocus)) {
        const t = (this.elapsed / 1800 + index * 0.27) % 1;
        const pulse = quadPoint(a, ctrl, b, t);
        this.spark(pulse.x, pulse.y, selectedPath || hoveredPath ? 2.3 : 1.8);
      }
      ctx.restore();
    });

    // Recorded and inferred document relationships render over the neural paths.
    this.edges.forEach((edge, index) => {
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (!a || !b) return;
      const style = RELATION_STYLES[edge.type] ?? {
        color: MUTED,
        label: edge.type,
      };
      const selectedPath = Boolean(selectedId && (edge.from === selectedId || edge.to === selectedId));
      const hoveredPath = Boolean(this.hoveredNodeId && (edge.from === this.hoveredNodeId || edge.to === this.hoveredNodeId));
      const isActive = selectedPath || hoveredPath;
      const alpha = selectedPath
        ? 0.66 + (a.depth + b.depth) * 0.08
        : hoveredPath
          ? 0.43 + (a.depth + b.depth) * 0.06
          : hasFocus
            ? 0.24
            : 0.58;

      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const sign = index % 2 === 0 ? 1 : -1;
      const curve = 36 * sign;
      const ctrl = {
        x: midX + (-dy / length) * curve,
        y: midY + (dx / length) * curve,
      };

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = style.color;
      ctx.lineWidth = selectedPath ? 2.1 : hoveredPath ? 1.7 : 1.25;
      ctx.setLineDash(style.dash ?? []);
      if (style.dash && this.animating) {
        ctx.lineDashOffset = -this.elapsed * 0.02;
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(ctrl.x, ctrl.y, b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      if (style.arrow) {
        const dirX = b.x - ctrl.x;
        const dirY = b.y - ctrl.y;
        const dirLen = Math.max(1, Math.hypot(dirX, dirY));
        const tipX = b.x - (dirX / dirLen) * (b.radius + 2);
        const tipY = b.y - (dirY / dirLen) * (b.radius + 2);
        this.arrowhead(ctx, ctrl.x, ctrl.y, tipX, tipY, 7.5, style.color, alpha);
      }

      // Edge relation label pill badge
      if (isActive) {
        const labelPoint = quadPoint(a, ctrl, b, 0.5);
        this.relationBadge(
          ctx,
          style.label,
          labelPoint.x,
          labelPoint.y - 10,
          isActive,
        );
      }

      // Action potential spark packets traveling along document relation
      if (this.animating && (isActive || !hasFocus)) {
        const t = (this.elapsed / 1300 + index * 0.33) % 1;
        const pulse = quadPoint(a, ctrl, b, t);
        this.spark(pulse.x, pulse.y, selectedPath || hoveredPath ? 2.4 : 2);
      }
    });

    // 7. Document Nodes (Cognitive Knowledge Hubs)
    this.nodes.forEach((node) => {
      const p = byId.get(node.id);
      if (!p) return;
      const isSelected = node.id === selectedId;
      const isHovered = node.id === this.hoveredNodeId;
      const isDimmed = connected ? !connected.has(node.id) : false;
      const nodeAlpha = isDimmed ? 0.72 : 1;
      const statusColor = STATUS_COLORS[node.status] ?? "#ff9c62";

      const isActiveNode = activeNodes.has(node.id);
      if (isSelected || (!selectedId && isHovered) || (this.animating && isActiveNode && !hasFocus)) {
        const phase = [...node.id].reduce(
          (sum, char) => sum + char.charCodeAt(0),
          0,
        ) % 17 / 17;
        this.drawPulseRing(ctx, p.x, p.y, p.radius + 7, phase);
      }

      ctx.globalAlpha = nodeAlpha;

      // Outer glowing halo
      if (isSelected || isHovered) {
        ctx.shadowColor = "#ff8838";
        ctx.shadowBlur = isSelected ? 12 : 5;
      }

      // Outer cortical ring (status-colored)
      ctx.strokeStyle = statusColor;
      ctx.lineWidth = isSelected ? 2.4 : isHovered ? 2 : 1.8;
      ctx.fillStyle = "rgba(11, 13, 12, 0.9)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Inner glowing nucleus
      ctx.fillStyle = isSelected ? "#ffffff" : "#ff9c62";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * 0.65, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      // Document Label with high-contrast badge pill
      if (isSelected || isHovered || (connected && connected.has(node.id))) {
        this.drawNodeLabel(
          ctx,
          node,
          p.x,
          p.y + p.radius + 12,
          isSelected,
          isDimmed,
          w < 440,
        );
      }
    });
  }

  private computeConnected(selectedId: string) {
    const set = new Set<string>([selectedId]);
    for (const edge of this.edges) {
      if (edge.from === selectedId) set.add(edge.to);
      if (edge.to === selectedId) set.add(edge.from);
    }
    for (const [from, to] of this.neuralEdges) {
      if (from === selectedId) set.add(to);
      if (to === selectedId) set.add(from);
    }
    return set;
  }

  private buildNeuralEdges(ids: string[]): Array<[string, string]> {
    const edges = new Map<string, [string, string]>();
    if (ids.length < 2) return [];
    const add = (a: string, b: string) => {
      if (a === b) return;
      const pair = [a, b].sort() as [string, string];
      edges.set(`${pair[0]}:${pair[1]}`, pair);
    };
    ids.forEach((id, index) => {
      const offsets = [1, 2, Math.floor(ids.length / 2)];
      for (const offset of offsets) {
        add(id, ids[(index + Math.max(1, offset)) % ids.length]);
      }
    });
    return [...edges.values()];
  }

  private drawPulseRing(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    phaseOffset = 0,
  ) {
    const pulse = (this.elapsed / 2200 + phaseOffset) % 1;
    ctx.strokeStyle = `rgba(255, 125, 45, ${(1 - pulse) * 0.6})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, radius + pulse * 18, 0, Math.PI * 2);
    ctx.stroke();
  }

  private arrowhead(
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    size: number,
    color: string,
    alpha: number,
  ) {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(toX, toY);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, -size * 0.5);
    ctx.lineTo(-size, size * 0.5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  private spark(x: number, y: number, radius: number) {
    const ctx = this.context;
    ctx.fillStyle = "rgba(255, 132, 63, 0.15)";
    ctx.beginPath();
    ctx.arc(x, y, radius * 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffac70";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawNodeLabel(
    ctx: CanvasRenderingContext2D,
    node: SceneNode,
    x: number,
    y: number,
    isSelected: boolean,
    isDimmed: boolean,
    isMobile: boolean,
  ) {
    const maxChars = isMobile ? 15 : 24;
    const labelText = truncate(node.label, maxChars);
    const ext = node.ext;

    ctx.font = isSelected
      ? "600 11px Geist, sans-serif"
      : "11px Geist, sans-serif";
    const textWidth = ctx.measureText(labelText).width;
    const extWidth = 24;
    const pillWidth = textWidth + extWidth + 14;
    const pillHeight = 20;
    const pillX = x - pillWidth / 2;
    const pillY = y - 9;

    ctx.save();
    ctx.globalAlpha = isDimmed ? 0.35 : 1;

    // Glassmorphic pill container
    ctx.fillStyle = isSelected ? "rgba(20, 24, 20, 0.94)" : "rgba(11, 13, 12, 0.88)";
    ctx.strokeStyle = isSelected
      ? "rgba(255, 156, 98, 0.8)"
      : "rgba(142, 154, 142, 0.3)";
    ctx.lineWidth = isSelected ? 1.4 : 1;
    this.roundRect(ctx, pillX, pillY, pillWidth, pillHeight, 6);
    ctx.fill();
    ctx.stroke();

    // Extension badge
    const extBg = getExtColor(ext);
    ctx.fillStyle = extBg;
    this.roundRect(ctx, pillX + 3, pillY + 3, extWidth, 14, 4);
    ctx.fill();

    ctx.font = "bold 8px Geist Mono, monospace";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ext.slice(0, 3), pillX + 3 + extWidth / 2, pillY + 10);

    // Document label text
    ctx.font = isSelected
      ? "600 11px Geist, sans-serif"
      : "11px Geist, sans-serif";
    ctx.fillStyle = isSelected ? "#ffffff" : TEXT_DIM;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(labelText, pillX + extWidth + 8, pillY + 10);

    // Anatomical lobe annotation for selected node
    ctx.restore();
  }

  private relationBadge(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    isActive: boolean,
  ) {
    ctx.font = "9px Geist Mono, monospace";
    const textWidth = ctx.measureText(text).width;
    const pad = 6;
    const w = textWidth + pad * 2;
    const h = 16;

    ctx.save();
    ctx.fillStyle = "rgba(11, 13, 12, 0.92)";
    ctx.strokeStyle = isActive
      ? "rgba(255, 156, 98, 0.6)"
      : "rgba(142, 154, 142, 0.3)";
    ctx.lineWidth = 1;
    this.roundRect(ctx, x - w / 2, y - h / 2, w, h, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isActive ? "#ffc6a2" : "rgba(186, 197, 186, 0.5)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    const id = this.hitTest(event.clientX, event.clientY);
    if (!id) return;
    const node = this.nodes.find((item) => item.id === id);
    if (!node) return;
    this.dragNodeId = id;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragStartOffset = { x: node.ox, y: node.oy };
    this.moved = false;
    this.canvas.style.cursor = "grabbing";
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // pointer capture is best-effort
    }
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (this.dragNodeId) {
      const dx = event.clientX - this.dragStartX;
      const dy = event.clientY - this.dragStartY;
      if (!this.moved && Math.hypot(dx, dy) > 4) this.moved = true;
      if (this.moved) {
        const node = this.nodes.find((item) => item.id === this.dragNodeId);
        if (node) {
          node.ox = this.dragStartOffset.x + dx;
          node.oy = this.dragStartOffset.y + dy;
          this.draw();
        }
      }
      return;
    }

    const hitId = this.closestNode(event.clientX, event.clientY, 18);
    if (hitId !== this.hoveredNodeId) {
      this.hoveredNodeId = hitId;
      this.canvas.style.cursor = this.hitTest(event.clientX, event.clientY)
        ? "pointer"
        : "grab";
      this.draw();
    }

    if (event.pointerType === "touch") return;
    const bounds = this.canvas.getBoundingClientRect();
    this.targetTiltX =
      ((event.clientX - bounds.left) / bounds.width - 0.5) * 0.09;
    this.targetTiltY =
      ((event.clientY - bounds.top) / bounds.height - 0.5) * 0.07;
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (event.type !== "pointercancel" && this.dragNodeId && !this.moved) {
      this.onSelect(this.dragNodeId);
    }
    this.dragNodeId = null;
    this.moved = false;
    this.canvas.style.cursor = this.hoveredNodeId ? "pointer" : "grab";
    try {
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // pointer capture is best-effort
    }
  };

  private readonly onPointerLeave = () => {
    this.targetTiltX = 0;
    this.targetTiltY = 0;
    this.hoveredNodeId = null;
    this.draw();
  };

  hitTest(clientX: number, clientY: number): string | null {
    const nearest = this.closestNode(clientX, clientY);
    if (!nearest) return null;
    const point = this.projected.find((node) => node.id === nearest);
    if (!point) return null;
    const bounds = this.canvas.getBoundingClientRect();
    return Math.hypot(point.x - (clientX - bounds.left), point.y - (clientY - bounds.top)) < 34
      ? nearest
      : null;
  }

  private closestNode(
    clientX: number,
    clientY: number,
    maxDistance = Number.POSITIVE_INFINITY,
  ): string | null {
    const bounds = this.canvas.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    let nearest = Number.POSITIVE_INFINITY;
    let id: string | null = null;
    this.projected.forEach((point) => {
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < nearest && distance <= maxDistance) {
        nearest = distance;
        id = point.id;
      }
    });
    return id;
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    document.removeEventListener("visibilitychange", this.refresh);
    this.reduceMotion.removeEventListener("change", this.refresh);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
  }
}
