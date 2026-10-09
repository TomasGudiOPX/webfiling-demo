import type { RelationGraph } from "../types";
import { brainFilePositions, createBrainMesh } from "./brain-geometry";

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
    dash: [6, 5],
    label: "vínculo sugerido",
  },
};

const TEXT_DIM = "#bac5ba";
const BG = "#0b0d0c";
const MUTED = "#8e9a8e";

type Point = { x: number; y: number };

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
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
}

interface SceneEdge {
  from: string;
  to: string;
  type: string;
}

interface ProjectedNode {
  id: string;
  x: number;
  y: number;
  depth: number;
  radius: number;
}

interface SceneState {
  selectedId: string | null;
  paused?: boolean;
}

function quadPoint(from: Point, ctrl: Point, to: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y,
  };
}

/**
 * A deterministic, animated 3D document-relation graph drawn on a 2D canvas.
 * Mirrors the visual language of the openix-landing neural scene: gentle
 * rotation, perspective depth, breathing, a soft glow, and impulses that
 * travel along the connections.
 */
export class RelationScene {
  private readonly context: CanvasRenderingContext2D;
  private readonly nodes: SceneNode[];
  private readonly edges: SceneEdge[];
  private readonly mesh = createBrainMesh();
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

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly graph: RelationGraph,
    private readonly state: () => SceneState,
    private readonly onSelect: (nodeId: string) => void,
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.context = context;

    const positions = brainFilePositions(graph.nodes.map((node) => node.id));
    this.nodes = graph.nodes.map((node) => {
      const p = positions.get(node.id)!;
      return {
        id: node.id,
        label: node.label,
        status: node.status,
        nx: p.x,
        ny: p.y,
        nz: p.z,
        ox: 0,
        oy: 0,
      };
    });
    this.edges = graph.edges.filter(
      (edge) => positions.has(edge.from) && positions.has(edge.to),
    );

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
    const cy = h * 0.5;
    const scaleX = Math.min(w * 0.38, h * 0.51);
    const scaleY = Math.min(h * 0.4, w * 0.46);
    const angle = 0.18 + 0.12 * Math.sin(this.elapsed * 0.00018) + this.tiltX;
    const pitch = Math.sin(this.elapsed * 0.00036) * 0.14 + this.tiltY;
    const breathing = 1 + Math.sin(this.elapsed * 0.0017) * 0.022;
    const project = (point: { x: number; y: number; z: number }) => {
      const x = point.x * breathing,
        y = point.y * breathing;
      const rx = x * Math.cos(angle) + point.z * Math.sin(angle);
      const rz = -x * Math.sin(angle) + point.z * Math.cos(angle);
      const ry = y * Math.cos(pitch) - rz * Math.sin(pitch);
      const z = y * Math.sin(pitch) + rz * Math.cos(pitch);
      const perspective = 2.8 / (2.8 - z * 0.38);
      return {
        x: cx + rx * scaleX * perspective,
        y: cy + ry * scaleY * perspective,
        depth: Math.max(0, Math.min(1, (z + 1) / 2)),
      };
    };

    const glow = ctx.createRadialGradient(
      cx,
      cy,
      5,
      cx,
      cy,
      Math.max(scaleX, scaleY) * 1.15,
    );
    glow.addColorStop(0, "rgba(255,103,32,0.05)");
    glow.addColorStop(1, "rgba(255,103,32,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const mesh = this.mesh.points.map(project);
    for (const [i, j] of this.mesh.edges) {
      const a = mesh[i],
        b = mesh[j];
      ctx.strokeStyle = `rgba(184,203,164,${0.08 + (a.depth + b.depth) * 0.1})`;
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (const point of mesh) {
      ctx.fillStyle = `rgba(206,218,189,${0.25 + point.depth * 0.45})`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.1 + point.depth * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    this.projected = this.nodes.map((node) => {
      const drift = Math.sin(this.elapsed * 0.0011 + node.nz * 9) * 0.004;
      const driftY = Math.cos(this.elapsed * 0.0013 + node.nz * 7) * 0.004;
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
        radius: 5 + depth * 3,
      };
    });
    const byId = new Map(this.projected.map((p) => [p.id, p]));

    const connected = selectedId ? this.computeConnected(selectedId) : null;

    this.edges.forEach((edge, index) => {
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (!a || !b) return;
      const style = RELATION_STYLES[edge.type] ?? {
        color: MUTED,
        label: edge.type,
      };
      const isActive =
        !connected || edge.from === selectedId || edge.to === selectedId;
      const alpha = isActive ? 0.5 + (a.depth + b.depth) * 0.2 : 0.12;

      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const sign = index % 2 === 0 ? 1 : -1;
      const curve = 42 * sign;
      const ctrl = {
        x: midX + (-dy / length) * curve,
        y: midY + (dx / length) * curve,
      };

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = style.color;
      ctx.lineWidth = isActive ? 2.4 : 1.6;
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
        this.arrowhead(ctx, ctrl.x, ctrl.y, tipX, tipY, 7, style.color, alpha);
      }

      const labelPoint = quadPoint(a, ctrl, b, 0.5);
      if (selectedId === edge.from || selectedId === edge.to)
        this.text(
          ctx,
          style.label,
          labelPoint.x,
          labelPoint.y - 8,
          "9px Geist Mono, monospace",
          isActive ? TEXT_DIM : "rgba(186,197,186,0.35)",
        );

      if (this.animating && isActive) {
        const t = (this.elapsed / 1400 + index * 0.37) % 1;
        const pulse = quadPoint(a, ctrl, b, t);
        this.spark(pulse.x, pulse.y, 2.4);
      }
    });

    this.nodes.forEach((node) => {
      const p = byId.get(node.id);
      if (!p) return;
      const color = "#ff9c62";
      const isSelected = node.id === selectedId;
      const isDimmed = connected ? !connected.has(node.id) : false;
      const nodeAlpha = isDimmed ? 0.28 : 1;

      if (isSelected) {
        this.drawPulseRing(ctx, p.x, p.y, p.radius + 6);
      }

      ctx.globalAlpha = nodeAlpha;
      if (isSelected) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
      }
      ctx.fillStyle = "#ff9c62";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      this.text(
        ctx,
        truncate(node.label, w < 400 ? 14 : 25),
        p.x,
        p.y + p.radius + 13,
        isSelected ? "600 11px Geist, sans-serif" : "11px Geist, sans-serif",
        isSelected ? "#ffffff" : TEXT_DIM,
      );
    });
  }

  private computeConnected(selectedId: string) {
    const set = new Set<string>([selectedId]);
    for (const edge of this.edges) {
      if (edge.from === selectedId) set.add(edge.to);
      if (edge.to === selectedId) set.add(edge.from);
    }
    return set;
  }

  private drawPulseRing(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
  ) {
    const pulse = (this.elapsed / 2300) % 1;
    ctx.strokeStyle = `rgba(255,103,32,${(1 - pulse) * 0.5})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, radius + pulse * 16, 0, Math.PI * 2);
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
    ctx.fillStyle = "rgba(255,132,63,0.12)";
    ctx.beginPath();
    ctx.arc(x, y, radius * 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffac70";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffe6c7";
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.43, 0, Math.PI * 2);
    ctx.fill();
  }

  private text(
    ctx: CanvasRenderingContext2D,
    value: string,
    x: number,
    y: number,
    font: string,
    fill: string,
  ) {
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = BG;
    ctx.strokeText(value, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(value, x, y);
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
    if (event.pointerType === "touch") return;
    const bounds = this.canvas.getBoundingClientRect();
    this.targetTiltX =
      ((event.clientX - bounds.left) / bounds.width - 0.5) * 0.08;
    this.targetTiltY =
      ((event.clientY - bounds.top) / bounds.height - 0.5) * 0.06;
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (event.type !== "pointercancel" && this.dragNodeId && !this.moved) {
      this.onSelect(this.dragNodeId);
    }
    this.dragNodeId = null;
    this.moved = false;
    this.canvas.style.cursor = "";
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
  };

  hitTest(clientX: number, clientY: number): string | null {
    const bounds = this.canvas.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    let nearest = 34;
    let id: string | null = null;
    this.projected.forEach((point) => {
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < nearest) {
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
