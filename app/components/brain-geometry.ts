/** The two-hemisphere geometry used by openix-landing's NeuralScene.
 * This mesh is illustrative, not a source of document relationships. */
export function createBrainMesh() {
  const points: { x: number; y: number; z: number }[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 76; i++) {
      const y = 1 - (2 * (i + 0.5)) / 76;
      const r = Math.sqrt(1 - y * y);
      const phi = i * 2.3999632297;
      const fold = 0.93 + 0.045 * Math.sin(i * 3.91);
      points.push({
        x: side * (0.055 + (0.47 + 0.47 * Math.cos(phi)) * r * fold),
        y: y * 0.88,
        z: Math.sin(phi) * r * 0.72,
      });
    }
  }
  const edges: [number, number][] = [];
  const seen = new Set<string>();
  points.forEach((point, i) => {
    points
      .map((other, j) => ({
        j,
        distance: Math.hypot(
          point.x - other.x,
          point.y - other.y,
          (point.z - other.z) * 0.65,
        ),
      }))
      .filter(({ j, distance }) => j !== i && distance < 0.47)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 4)
      .forEach(({ j }) => {
        const key = `${Math.min(i, j)}:${Math.max(i, j)}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push([i, j]);
        }
      });
  });
  return { points, edges };
}

/** Files occupy separate hubs; their edges always come from the authorized graph. */
export function brainFilePositions(ids: string[]) {
  const sorted = [...ids].sort();
  return new Map(
    sorted.map((id, index) => {
      const side = index % 2 ? 1 : -1;
      const count = Math.ceil((sorted.length - (index % 2)) / 2);
      const row = Math.floor(index / 2);
      const y = count === 1 ? 0 : -0.62 + (row / (count - 1)) * 1.24;
      return [
        id,
        { x: side * (0.28 + 0.36 * Math.sqrt(1 - y * y)), y, z: 0.4 },
      ];
    }),
  );
}
