/** Deterministic positions for the document relationship network. */

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface GyriContour {
  name: string;
  points: Point3D[];
  side: -1 | 1 | 0; // -1: left hemisphere, 1: right hemisphere, 0: commissural
  type: "gyrus" | "sulcus" | "folia" | "stem" | "commissure";
}

// 76 anatomical landmark parameters per hemisphere
const FRONTAL_PARAMS = [
  { rX: 0.28, v: -0.15, z: 0.68, gyri: 0.04 },
  { rX: 0.40, v: -0.28, z: 0.64, gyri: -0.03 },
  { rX: 0.35, v: -0.42, z: 0.58, gyri: 0.05 },
  { rX: 0.48, v: -0.18, z: 0.56, gyri: -0.04 },
  { rX: 0.36, v: -0.58, z: 0.48, gyri: 0.04 },
  { rX: 0.52, v: -0.52, z: 0.46, gyri: -0.05 },
  { rX: 0.62, v: -0.38, z: 0.42, gyri: 0.03 },
  { rX: 0.38, v: -0.66, z: 0.32, gyri: 0.06 },
  { rX: 0.56, v: -0.60, z: 0.30, gyri: -0.04 },
  { rX: 0.66, v: -0.44, z: 0.28, gyri: 0.05 },
  { rX: 0.70, v: -0.24, z: 0.25, gyri: -0.03 },
  { rX: 0.60, v: -0.10, z: 0.32, gyri: 0.04 },
  { rX: 0.40, v: -0.70, z: 0.16, gyri: 0.05 },
  { rX: 0.58, v: -0.64, z: 0.14, gyri: -0.04 },
  { rX: 0.71, v: -0.48, z: 0.12, gyri: 0.03 },
  { rX: 0.72, v: -0.28, z: 0.10, gyri: -0.05 },
  { rX: 0.22, v: -0.25, z: 0.45, gyri: 0.02 },
  { rX: 0.36, v: -0.08, z: 0.42, gyri: -0.04 },
  { rX: 0.25, v: -0.45, z: 0.25, gyri: 0.03 },
  { rX: 0.44, v: -0.20, z: 0.22, gyri: -0.03 },
  { rX: 0.20, v: -0.05, z: 0.28, gyri: 0.02 },
  { rX: 0.32, v: 0.02,  z: 0.18, gyri: -0.02 },
];

const PARIETAL_PARAMS = [
  { rX: 0.42, v: -0.72, z: -0.02, gyri: 0.04 },
  { rX: 0.60, v: -0.66, z: -0.04, gyri: -0.05 },
  { rX: 0.72, v: -0.50, z: -0.06, gyri: 0.04 },
  { rX: 0.40, v: -0.71, z: -0.18, gyri: 0.05 },
  { rX: 0.59, v: -0.64, z: -0.20, gyri: -0.04 },
  { rX: 0.71, v: -0.48, z: -0.22, gyri: 0.03 },
  { rX: 0.38, v: -0.66, z: -0.34, gyri: 0.04 },
  { rX: 0.56, v: -0.58, z: -0.36, gyri: -0.05 },
  { rX: 0.68, v: -0.42, z: -0.38, gyri: 0.04 },
  { rX: 0.72, v: -0.26, z: -0.12, gyri: -0.03 },
  { rX: 0.70, v: -0.22, z: -0.28, gyri: 0.03 },
  { rX: 0.24, v: -0.55, z: -0.10, gyri: 0.02 },
  { rX: 0.25, v: -0.52, z: -0.26, gyri: -0.02 },
  { rX: 0.44, v: -0.44, z: -0.14, gyri: 0.03 },
  { rX: 0.42, v: -0.40, z: -0.28, gyri: -0.03 },
  { rX: 0.58, v: -0.34, z: -0.20, gyri: 0.02 },
];

const OCCIPITAL_PARAMS = [
  { rX: 0.34, v: -0.54, z: -0.48, gyri: 0.04 },
  { rX: 0.50, v: -0.46, z: -0.50, gyri: -0.04 },
  { rX: 0.62, v: -0.32, z: -0.52, gyri: 0.03 },
  { rX: 0.30, v: -0.38, z: -0.62, gyri: 0.04 },
  { rX: 0.44, v: -0.30, z: -0.64, gyri: -0.03 },
  { rX: 0.54, v: -0.18, z: -0.65, gyri: 0.03 },
  { rX: 0.24, v: -0.20, z: -0.72, gyri: 0.03 },
  { rX: 0.36, v: -0.12, z: -0.74, gyri: -0.02 },
  { rX: 0.22, v: -0.04, z: -0.70, gyri: 0.02 },
  { rX: 0.42, v: -0.06, z: -0.58, gyri: -0.03 },
  { rX: 0.26, v: -0.25, z: -0.42, gyri: 0.02 },
  { rX: 0.52, v: -0.12, z: -0.46, gyri: 0.02 },
];

const TEMPORAL_PARAMS = [
  { rX: 0.58, v: 0.12, z: 0.38, gyri: 0.04 },
  { rX: 0.66, v: 0.18, z: 0.32, gyri: -0.03 },
  { rX: 0.52, v: 0.26, z: 0.30, gyri: 0.03 },
  { rX: 0.72, v: 0.08, z: 0.14, gyri: 0.04 },
  { rX: 0.73, v: 0.22, z: 0.12, gyri: -0.04 },
  { rX: 0.60, v: 0.32, z: 0.10, gyri: 0.03 },
  { rX: 0.71, v: 0.10, z: -0.08, gyri: 0.03 },
  { rX: 0.72, v: 0.24, z: -0.10, gyri: -0.03 },
  { rX: 0.56, v: 0.34, z: -0.12, gyri: 0.03 },
  { rX: 0.66, v: 0.12, z: -0.26, gyri: 0.03 },
  { rX: 0.64, v: 0.26, z: -0.28, gyri: -0.03 },
  { rX: 0.48, v: 0.35, z: -0.25, gyri: 0.02 },
  { rX: 0.40, v: 0.22, z: 0.02,  gyri: -0.02 },
  { rX: 0.36, v: 0.28, z: -0.15, gyri: 0.02 },
];

const CEREBELLUM_PARAMS = [
  { rX: 0.36, v: 0.28, z: -0.42, gyri: 0.03 },
  { rX: 0.50, v: 0.32, z: -0.44, gyri: -0.03 },
  { rX: 0.35, v: 0.46, z: -0.48, gyri: 0.02 },
  { rX: 0.48, v: 0.48, z: -0.50, gyri: -0.02 },
  { rX: 0.30, v: 0.34, z: -0.60, gyri: 0.03 },
  { rX: 0.44, v: 0.38, z: -0.62, gyri: -0.03 },
  { rX: 0.28, v: 0.52, z: -0.62, gyri: 0.02 },
  { rX: 0.40, v: 0.55, z: -0.60, gyri: -0.02 },
];

const BRAINSTEM_PARAMS = [
  { rX: 0.14, v: 0.38, z: -0.05, gyri: 0.01 },
  { rX: 0.16, v: 0.48, z: -0.08, gyri: -0.01 },
  { rX: 0.13, v: 0.62, z: -0.10, gyri: 0.01 },
  { rX: 0.15, v: 0.74, z: -0.12, gyri: -0.01 },
];

const ALL_HEMISPHERE_PARAMS = [
  ...FRONTAL_PARAMS,
  ...PARIETAL_PARAMS,
  ...OCCIPITAL_PARAMS,
  ...TEMPORAL_PARAMS,
  ...CEREBELLUM_PARAMS,
  ...BRAINSTEM_PARAMS,
];

/**
 * Builds the deterministic 152-node anatomical connectome mesh of the two brain hemispheres.
 * Exactly 76 nodes in the left hemisphere (x < 0) and 76 nodes in the right hemisphere (x > 0).
 */
export function createBrainMesh(): { points: Point3D[]; edges: [number, number][] } {
  const points: Point3D[] = [];

  for (const side of [-1, 1] as const) {
    for (let i = 0; i < ALL_HEMISPHERE_PARAMS.length; i++) {
      const p = ALL_HEMISPHERE_PARAMS[i];
      const foldMod = 1 + p.gyri;
      const x = side * Math.max(0.055, p.rX * foldMod);
      const y = p.v * 0.96;
      const z = p.z * 0.92;
      points.push({ x, y, z });
    }
  }

  const edges: [number, number][] = [];
  const seen = new Set<string>();
  const add = (a: number, b: number) => {
    if (a === b) return;
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push([Math.min(a, b), Math.max(a, b)]);
    }
  };

  // Intra-hemispheric cortical connections (nearest neighbors)
  for (let s = 0; s < 2; s++) {
    const offset = s * 76;
    for (let i = 0; i < 76; i++) {
      const globalI = offset + i;
      const pI = points[globalI];
      const neighbors: { globalJ: number; dist: number }[] = [];
      for (let j = 0; j < 76; j++) {
        if (i === j) continue;
        const globalJ = offset + j;
        const pJ = points[globalJ];
        const dist = Math.hypot(pI.x - pJ.x, pI.y - pJ.y, (pI.z - pJ.z) * 0.75);
        if (dist < 0.38) {
          neighbors.push({ globalJ, dist });
        }
      }
      neighbors.sort((a, b) => a.dist - b.dist);
      neighbors.slice(0, 4).forEach((n) => add(globalI, n.globalJ));
    }
  }

  // Corpus Callosum: commissural bridge fibers across the medial longitudinal fissure
  for (let i = 0; i < 76; i++) {
    const p = points[i];
    if (Math.abs(p.x) < 0.28 && p.y > -0.65 && p.y < 0.15) {
      add(i, i + 76);
    }
  }

  return { points, edges };
}

/**
 * Anatomical gyri and sulci curves.
 * Projected in 3D to render the characteristic serpentine folds,
 * fissures, cerebellar folia and brainstem trunk of the human brain.
 */
export function createBrainContours(): GyriContour[] {
  const contours: GyriContour[] = [];

  for (const side of [-1, 1] as const) {
    // 1. Longitudinal Dorsal Arch (Frontal pole -> Parietal crown -> Occipital pole)
    contours.push({
      name: side === -1 ? "L Dorsal Arch" : "R Dorsal Arch",
      side,
      type: "gyrus",
      points: [
        { x: side * 0.24, y: -0.15, z: 0.65 },
        { x: side * 0.32, y: -0.38, z: 0.58 },
        { x: side * 0.38, y: -0.56, z: 0.44 },
        { x: side * 0.40, y: -0.68, z: 0.22 },
        { x: side * 0.42, y: -0.72, z: -0.04 },
        { x: side * 0.40, y: -0.68, z: -0.26 },
        { x: side * 0.36, y: -0.54, z: -0.46 },
        { x: side * 0.28, y: -0.30, z: -0.65 },
        { x: side * 0.18, y: -0.12, z: -0.72 },
      ],
    });

    // 2. Lateral Sulcus (Sylvian Fissure) - the iconic brain indentation
    contours.push({
      name: side === -1 ? "L Sylvian Fissure" : "R Sylvian Fissure",
      side,
      type: "sulcus",
      points: [
        { x: side * 0.50, y: 0.08, z: 0.36 },
        { x: side * 0.62, y: 0.04, z: 0.26 },
        { x: side * 0.68, y: 0.00, z: 0.12 },
        { x: side * 0.70, y: -0.06, z: -0.05 },
        { x: side * 0.66, y: -0.14, z: -0.22 },
        { x: side * 0.56, y: -0.22, z: -0.35 },
      ],
    });

    // 3. Central Sulcus (Rolandic Fissure) - motor/sensory boundary
    contours.push({
      name: side === -1 ? "L Central Sulcus" : "R Central Sulcus",
      side,
      type: "sulcus",
      points: [
        { x: side * 0.26, y: -0.70, z: 0.12 },
        { x: side * 0.46, y: -0.62, z: 0.10 },
        { x: side * 0.60, y: -0.48, z: 0.08 },
        { x: side * 0.68, y: -0.30, z: 0.06 },
        { x: side * 0.68, y: -0.08, z: 0.05 },
      ],
    });

    // 4. Temporal Lobe Arch (Superior & Middle Temporal Gyri)
    contours.push({
      name: side === -1 ? "L Temporal Gyrus" : "R Temporal Gyrus",
      side,
      type: "gyrus",
      points: [
        { x: side * 0.52, y: 0.16, z: 0.35 },
        { x: side * 0.64, y: 0.22, z: 0.25 },
        { x: side * 0.68, y: 0.26, z: 0.08 },
        { x: side * 0.66, y: 0.28, z: -0.12 },
        { x: side * 0.58, y: 0.24, z: -0.28 },
      ],
    });

    // 5. Frontal Lateral Ridge (Middle Frontal Gyrus)
    contours.push({
      name: side === -1 ? "L Frontal Ridge" : "R Frontal Ridge",
      side,
      type: "gyrus",
      points: [
        { x: side * 0.36, y: -0.24, z: 0.62 },
        { x: side * 0.52, y: -0.36, z: 0.48 },
        { x: side * 0.62, y: -0.44, z: 0.32 },
        { x: side * 0.66, y: -0.46, z: 0.16 },
      ],
    });

    // 6. Cerebellar Folia (Horizontal Striations under Occipital Lobe)
    contours.push({
      name: side === -1 ? "L Cerebellum Folia 1" : "R Cerebellum Folia 1",
      side,
      type: "folia",
      points: [
        { x: side * 0.18, y: 0.30, z: -0.42 },
        { x: side * 0.34, y: 0.32, z: -0.46 },
        { x: side * 0.46, y: 0.34, z: -0.50 },
        { x: side * 0.32, y: 0.36, z: -0.62 },
        { x: side * 0.16, y: 0.34, z: -0.58 },
      ],
    });
    contours.push({
      name: side === -1 ? "L Cerebellum Folia 2" : "R Cerebellum Folia 2",
      side,
      type: "folia",
      points: [
        { x: side * 0.16, y: 0.44, z: -0.44 },
        { x: side * 0.32, y: 0.46, z: -0.48 },
        { x: side * 0.42, y: 0.48, z: -0.52 },
        { x: side * 0.28, y: 0.52, z: -0.62 },
        { x: side * 0.14, y: 0.48, z: -0.58 },
      ],
    });
  }

  // 7. Brainstem Descending Trunk (Medulla & Pons)
  contours.push({
    name: "Brainstem Left Trunk",
    side: -1,
    type: "stem",
    points: [
      { x: -0.08, y: 0.28, z: -0.04 },
      { x: -0.10, y: 0.44, z: -0.06 },
      { x: -0.09, y: 0.60, z: -0.08 },
      { x: -0.07, y: 0.76, z: -0.10 },
    ],
  });
  contours.push({
    name: "Brainstem Right Trunk",
    side: 1,
    type: "stem",
    points: [
      { x: 0.08, y: 0.28, z: -0.04 },
      { x: 0.10, y: 0.44, z: -0.06 },
      { x: 0.09, y: 0.60, z: -0.08 },
      { x: 0.07, y: 0.76, z: -0.10 },
    ],
  });

  // 8. Corpus Callosum Transverse Arches (Crossing Longitudinal Fissure)
  contours.push({
    name: "Corpus Callosum Anterior",
    side: 0,
    type: "commissure",
    points: [
      { x: -0.22, y: -0.24, z: 0.30 },
      { x: -0.10, y: -0.22, z: 0.30 },
      { x: 0.00, y: -0.20, z: 0.30 },
      { x: 0.10, y: -0.22, z: 0.30 },
      { x: 0.22, y: -0.24, z: 0.30 },
    ],
  });
  contours.push({
    name: "Corpus Callosum Central",
    side: 0,
    type: "commissure",
    points: [
      { x: -0.24, y: -0.28, z: 0.00 },
      { x: -0.12, y: -0.26, z: 0.00 },
      { x: 0.00, y: -0.24, z: 0.00 },
      { x: 0.12, y: -0.26, z: 0.00 },
      { x: 0.24, y: -0.28, z: 0.00 },
    ],
  });
  contours.push({
    name: "Corpus Callosum Posterior",
    side: 0,
    type: "commissure",
    points: [
      { x: -0.22, y: -0.22, z: -0.24 },
      { x: -0.10, y: -0.20, z: -0.24 },
      { x: 0.00, y: -0.18, z: -0.24 },
      { x: 0.10, y: -0.20, z: -0.24 },
      { x: 0.22, y: -0.22, z: -0.24 },
    ],
  });

  return contours;
}

/** Spread files across the field so their connections remain readable. */
export function brainFilePositions(
  files: string[] | Array<{
    id: string;
    categoryId?: string | null;
    disciplineTag?: string | null;
    locationTag?: string | null;
  }>,
): Map<string, Point3D> {
  const layout = files.length > 0 && typeof files[0] !== "string"
    ? (files as Array<{
    id: string;
    categoryId?: string | null;
    disciplineTag?: string | null;
    locationTag?: string | null;
  }>).slice().sort((a, b) => a.id.localeCompare(b.id))
    : [];
  const positions = new Map<string, Point3D>();
  const ids = files.length > 0 && typeof files[0] === "string"
    ? (files as string[]).slice().sort()
    : layout.map((file) => file.id);
  const count = ids.length;
  ids.forEach((id, index) => {
    const angle = index * 2.399963 + hash01(id) * 0.22;
    const radius = 0.12 + 0.76 * Math.sqrt((index + 0.5) / Math.max(count, 1));
    const jitter = (hash01(`${id}:spread`) - 0.5) * 0.08;
    positions.set(id, {
      x: Math.cos(angle) * (radius + jitter),
      y: Math.sin(angle) * (radius + jitter) * 0.92,
      z: (hash01(`${id}:depth`) - 0.5) * 0.32,
    });
  });
  return positions;
}

function hash01(value: string) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967295;
}

/** Identifies the anatomical lobe name for a 3D coordinate point. */
export function getLobeName(p: Point3D): string {
  if (p.y > 0.35 && p.z < -0.25) return "Cerebelo";
  if (p.y > 0.45 && Math.abs(p.x) < 0.22) return "Tronco encefálico";
  if (p.y > 0.05 && p.z > -0.25 && Math.abs(p.x) > 0.35) return "Lóbulo temporal";
  if (p.z > 0.15 && p.y < 0.10) return "Lóbulo frontal";
  if (p.z < -0.35 && p.y < 0.15) return "Lóbulo occipital";
  return "Lóbulo parietal";
}
