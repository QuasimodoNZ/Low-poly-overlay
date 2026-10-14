import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  isSimplePolygon,
  triangulate,
  triangulatePoints,
  subdividePolygon,
  subdivisionFaceCount,
  closestPointOnSegment,
  closestEdge,
  segmentsIntersect,
  pointInTriangle,
  ensureCounterClockwise,
  findNearestVertex,
} from '../src/geometry.js';

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

// An L-shaped (concave) polygon.
const lShape = [
  { x: 0, y: 0 },
  { x: 6, y: 0 },
  { x: 6, y: 2 },
  { x: 2, y: 2 },
  { x: 2, y: 6 },
  { x: 0, y: 6 },
];

test('pointInPolygon detects inside / outside / boundary', () => {
  assert.equal(pointInPolygon({ x: 5, y: 5 }, square), true);
  assert.equal(pointInPolygon({ x: -1, y: 5 }, square), false);
  assert.equal(pointInPolygon({ x: 11, y: 11 }, square), false);
  assert.equal(pointInPolygon({ x: 0, y: 5 }, square), true); // on edge
  assert.equal(pointInPolygon({ x: 0, y: 0 }, square), true); // on vertex
});

test('pointInPolygon handles concave shapes', () => {
  // Inside the L, in the lower arm.
  assert.equal(pointInPolygon({ x: 1, y: 1 }, lShape), true);
  // In the missing corner (outside the L).
  assert.equal(pointInPolygon({ x: 5, y: 5 }, lShape), false);
  // Near the inner corner, just inside.
  assert.equal(pointInPolygon({ x: 1.5, y: 1.5 }, lShape), true);
});

test('polygonArea is signed and correct', () => {
  assert.equal(polygonArea(square), 100);
  const reversed = square.slice().reverse();
  assert.equal(polygonArea(reversed), -100);
  assert.equal(polygonArea(lShape), 6 * 2 + 2 * 4); // 20, split into two rectangles
});

test('ensureCounterClockwise normalises winding', () => {
  const ccw = ensureCounterClockwise(square.slice().reverse());
  assert.ok(polygonArea(ccw) > 0);
});

test('polygonBounds and centroid', () => {
  const bounds = polygonBounds(square);
  assert.deepEqual(bounds, { minX: 0, minY: 0, maxX: 10, maxY: 10, width: 10, height: 10 });
  const centroid = polygonCentroid(square);
  assert.ok(Math.abs(centroid.x - 5) < 1e-9);
  assert.ok(Math.abs(centroid.y - 5) < 1e-9);
});

test('isSimplePolygon accepts valid and rejects self-intersecting rings', () => {
  assert.equal(isSimplePolygon(square), true);
  assert.equal(isSimplePolygon(lShape), true);

  // Bow-tie / figure-eight.
  const bowtie = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ];
  assert.equal(isSimplePolygon(bowtie), false);

  // Zero-area / duplicated vertices.
  assert.equal(isSimplePolygon([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }]), false);
  assert.equal(isSimplePolygon([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]), false);
});

test('segmentsIntersect works for crossing and non-crossing cases', () => {
  assert.equal(
    segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }),
    true,
  );
  assert.equal(
    segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }),
    false,
  );
});

test('pointInTriangle', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  const c = { x: 0, y: 10 };
  assert.equal(pointInTriangle({ x: 1, y: 1 }, a, b, c), true);
  assert.equal(pointInTriangle({ x: 9, y: 9 }, a, b, c), false);
});

test('triangulate produces n - 2 triangles covering the polygon', () => {
  for (const polygon of [square, lShape]) {
    const tris = triangulate(polygon);
    assert.equal(tris.length, polygon.length - 2, `triangle count for ${polygon.length}-gon`);

    const total = tris.reduce(
      (sum, [i, j, k]) =>
        sum + Math.abs(polygonArea([polygon[i], polygon[j], polygon[k]])),
      0,
    );
    assert.ok(Math.abs(total - Math.abs(polygonArea(polygon))) < 1e-6, 'areas sum to polygon area');

    // Triangles only reference original vertices.
    for (const tri of tris) {
      for (const index of tri) assert.ok(index >= 0 && index < polygon.length);
    }
  }
});

test('triangulate keeps all generated triangles inside a concave polygon', () => {
  const tris = triangulatePoints(lShape);
  for (const tri of tris) {
    const c = {
      x: (tri[0].x + tri[1].x + tri[2].x) / 3,
      y: (tri[0].y + tri[1].y + tri[2].y) / 3,
    };
    assert.equal(pointInPolygon(c, lShape), true, `centroid ${JSON.stringify(c)} inside polygon`);
  }
});

test('triangulate rejects self-intersecting polygons', () => {
  const bowtie = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ];
  assert.throws(() => triangulate(bowtie));
});

test('subdividePolygon keeps faces inside and sums to the polygon area', () => {
  for (const iterations of [0, 1, 2]) {
    const faces = subdividePolygon(lShape, iterations);
    assert.equal(faces.length, subdivisionFaceCount(lShape.length, iterations));

    let total = 0;
    for (const face of faces) {
      total += Math.abs(polygonArea(face));
      const c = {
        x: (face[0].x + face[1].x + face[2].x) / 3,
        y: (face[0].y + face[1].y + face[2].y) / 3,
      };
      assert.equal(pointInPolygon(c, lShape), true, 'face centroid stays inside');
    }
    assert.ok(Math.abs(total - Math.abs(polygonArea(lShape))) < 1e-6, 'no gaps or overlaps');
  }
});

test('findNearestVertex picks the closest vertex inside the radius', () => {
  const groups = [{ vertices: square }];

  const hit = findNearestVertex({ x: 9, y: 9 }, groups, 2.5);
  assert.deepEqual(hit.point, { x: 10, y: 10 });
  assert.equal(hit.index, 2);
  assert.equal(hit.distance, Math.hypot(1, 1));

  // Out of range -> no snap.
  assert.equal(findNearestVertex({ x: 5, y: 5 }, groups, 2.5), null);
  assert.equal(findNearestVertex({ x: 5, y: 5 }, groups, 0), null);
});

test('findNearestVertex honours exclusions and prefers the nearer group', () => {
  const groups = [
    { vertices: [{ x: 0, y: 0 }], ref: 'a' },
    { vertices: [{ x: 1, y: 0 }], ref: 'b' },
  ];
  assert.equal(findNearestVertex({ x: 0.9, y: 0 }, groups, 5).ref, 'b');

  const excluded = [{ vertices: [{ x: 1, y: 0 }], excludeIndices: new Set([0]) }];
  assert.equal(findNearestVertex({ x: 1, y: 0 }, excluded, 5), null);
});

test('closestPointOnSegment and closestEdge', () => {
  const hit = closestPointOnSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 });
  assert.equal(hit.distance, 3);
  assert.deepEqual(hit.point, { x: 5, y: 0 });

  const edge = closestEdge({ x: 5, y: -1 }, square);
  assert.equal(edge.index, 0);
  assert.equal(edge.distance, 1);
});
