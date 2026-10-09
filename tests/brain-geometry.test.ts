import assert from "node:assert/strict";
import test from "node:test";
import {
  brainFilePositions,
  createBrainMesh,
} from "../app/components/brain-geometry";

test("brain silhouette reuses deterministic two-hemisphere geometry without file data", () => {
  const mesh = createBrainMesh();
  assert.deepEqual(mesh, createBrainMesh());
  assert.equal(mesh.points.length, 152);
  assert.ok(mesh.points.slice(0, 76).every((point) => point.x < 0));
  assert.ok(mesh.points.slice(76).every((point) => point.x > 0));
  assert.equal(
    new Set(mesh.edges.map(([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}`))
      .size,
    mesh.edges.length,
  );
  assert.ok(
    mesh.edges.every(([a, b]) => a !== b && mesh.points[a] && mesh.points[b]),
  );
});

test("file hubs contain only supplied identities with stable, finite positions", () => {
  for (const count of [0, 1, 2, 6, 37]) {
    const ids = Array.from({ length: count }, (_, i) => `file-${i}`);
    const positions = brainFilePositions(ids);
    assert.equal(positions.size, count);
    assert.deepEqual(positions, brainFilePositions([...ids].reverse()));
    assert.deepEqual([...positions.keys()].sort(), [...ids].sort());
    for (const point of positions.values()) {
      assert.ok(Object.values(point).every(Number.isFinite));
      assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1);
    }
  }
});
