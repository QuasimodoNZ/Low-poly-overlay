/**
 * Pure geometry helpers.
 *
 * Every function operates in "image space" (original image pixel coordinates)
 * unless stated otherwise. Nothing in here touches the DOM, which keeps the
 * module unit-testable in Node.
 *
 * A point is `{ x, y }`. A polygon is an ordered array of points.
 */

export const EPS = 1e-9;

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scalePoint(a, k) {
  return { x: a.x * k, y: a.y * k };
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Cross product of (a - o) x (b - o). Positive => counter-clockwise turn. */
export function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Signed area (shoelace). Positive => counter-clockwise winding. */
export function polygonArea(vertices) {
  const n = vertices.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const p = vertices[i];
    const q = vertices[(i + 1) % n];
    total += p.x * q.y - q.x * p.y;
  }
  return total / 2;
}

export function polygonPerimeter(vertices) {
  const n = vertices.length;
  if (n < 2) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += distance(vertices[i], vertices[(i + 1) % n]);
  }
  return total;
}

export function isClockwise(vertices) {
  return polygonArea(vertices) < 0;
}

export function ensureCounterClockwise(vertices) {
  return isClockwise(vertices) ? vertices.slice().reverse() : vertices.slice();
}

export function polygonBounds(vertices) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of vertices) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Area-weighted centroid of a polygon (falls back to vertex mean for degenerate shapes). */
export function polygonCentroid(vertices) {
  const area = polygonArea(vertices);
  if (Math.abs(area) < EPS) {
    if (vertices.length === 0) return { x: 0, y: 0 };
    let sx = 0;
    let sy = 0;
    for (const p of vertices) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / vertices.length, y: sy / vertices.length };
  }
  let cx = 0;
  let cy = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const p = vertices[i];
    const q = vertices[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/**
 * Ray-casting point-in-polygon test. Points exactly on an edge are considered
 * inside when `includeBoundary` is true (default).
 */
export function pointInPolygon(point, vertices, includeBoundary = true) {
  const n = vertices.length;
  if (n < 3) return false;

  if (includeBoundary) {
    for (let i = 0; i < n; i++) {
      if (pointOnSegment(point, vertices[i], vertices[(i + 1) % n])) return true;
    }
  }

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = vertices[i];
    const b = vertices[j];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointOnSegment(point, a, b, tolerance = 1e-7) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < EPS) return Math.hypot(apx, apy) <= tolerance;
  let t = (apx * abx + apy * aby) / lenSq;
  if (t < 0 || t > 1) return false;
  const projX = a.x + abx * t;
  const projY = a.y + aby * t;
  return Math.hypot(point.x - projX, point.y - projY) <= tolerance;
}

export function pointInTriangle(point, a, b, c) {
  const d1 = cross(a, b, point);
  const d2 = cross(b, c, point);
  const d3 = cross(c, a, point);
  const hasNeg = d1 < -EPS || d2 < -EPS || d3 < -EPS;
  const hasPos = d1 > EPS || d2 > EPS || d3 > EPS;
  return !(hasNeg && hasPos);
}

function orientation(p, q, r) {
  const v = cross(p, q, r);
  if (Math.abs(v) < 1e-9) return 0;
  return v > 0 ? 1 : 2;
}

function onSegmentBounded(p, q, r) {
  return (
    q.x <= Math.max(p.x, r.x) + 1e-9 &&
    q.x >= Math.min(p.x, r.x) - 1e-9 &&
    q.y <= Math.max(p.y, r.y) + 1e-9 &&
    q.y >= Math.min(p.y, r.y) - 1e-9
  );
}

/** True when two line segments intersect or touch. */
export function segmentsIntersect(p1, q1, p2, q2) {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) return true;

  if (o1 === 0 && onSegmentBounded(p1, p2, q1)) return true;
  if (o2 === 0 && onSegmentBounded(p1, q2, q1)) return true;
  if (o3 === 0 && onSegmentBounded(p2, p1, q2)) return true;
  if (o4 === 0 && onSegmentBounded(p2, q1, q2)) return true;

  return false;
}

/** Distance from a point to a segment, plus the closest point. */
export function closestPointOnSegment(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < EPS) return { point: { ...a }, distance: distance(point, a), t: 0 };
  let t = ((point.x - a.x) * abx + (point.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projected = { x: a.x + abx * t, y: a.y + aby * t };
  return { point: projected, distance: distance(point, projected), t };
}

/** Find the closest edge of a polygon to a point. */
export function closestEdge(point, vertices) {
  const n = vertices.length;
  let best = { index: -1, distance: Infinity, point: null, t: 0 };
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const hit = closestPointOnSegment(point, a, b);
    if (hit.distance < best.distance) {
      best = { index: i, distance: hit.distance, point: hit.point, t: hit.t };
    }
  }
  return best;
}

/**
 * A polygon is "simple" when its boundary does not cross itself. This rejects
 * self-intersecting rings, duplicated consecutive vertices and zero-area rings.
 */
export function isSimplePolygon(vertices) {
  const n = vertices.length;
  if (n < 3) return false;
  if (Math.abs(polygonArea(vertices)) < EPS) return false;

  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    if (distance(a, b) < EPS) return false;
  }

  for (let i = 0; i < n; i++) {
    const a1 = vertices[i];
    const a2 = vertices[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Skip edges that share a vertex.
      if (i === j) continue;
      if ((j + 1) % n === i || (i + 1) % n === j) continue;
      const b1 = vertices[j];
      const b2 = vertices[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

/**
 * Ear-clipping triangulation of an arbitrary simple polygon (concave allowed).
 * Returns an array of index triples into `vertices`. Throws if the polygon is
 * invalid.
 */
export function triangulate(vertices) {
  const n = vertices.length;
  if (n < 3) return [];
  if (!isSimplePolygon(vertices)) {
    throw new Error('Cannot triangulate a self-intersecting or degenerate polygon');
  }
  if (n === 3) return [[0, 1, 2]];

  let indices = [...Array(n).keys()];
  if (polygonArea(vertices) < 0) indices.reverse();

  const triangles = [];
  let guard = 0;
  const maxIterations = n * n + 10;

  while (indices.length > 3 && guard++ < maxIterations) {
    const m = indices.length;
    let clipped = false;

    for (let i = 0; i < m; i++) {
      const i0 = indices[(i - 1 + m) % m];
      const i1 = indices[i];
      const i2 = indices[(i + 1) % m];
      const a = vertices[i0];
      const b = vertices[i1];
      const c = vertices[i2];

      if (cross(a, b, c) <= EPS) continue; // reflex or collinear in CCW winding

      let containsVertex = false;
      for (let j = 0; j < m; j++) {
        const k = indices[j];
        if (k === i0 || k === i1 || k === i2) continue;
        if (pointInTriangle(vertices[k], a, b, c)) {
          containsVertex = true;
          break;
        }
      }
      if (containsVertex) continue;

      triangles.push([i0, i1, i2]);
      indices.splice(i, 1);
      clipped = true;
      break;
    }

    if (!clipped) {
      // Numerical fallback: clip the first convex vertex, then give up safely.
      for (let i = 0; i < indices.length; i++) {
        const m2 = indices.length;
        const i0 = indices[(i - 1 + m2) % m2];
        const i1 = indices[i];
        const i2 = indices[(i + 1) % m2];
        if (cross(vertices[i0], vertices[i1], vertices[i2]) > EPS) {
          triangles.push([i0, i1, i2]);
          indices.splice(i, 1);
          clipped = true;
          break;
        }
      }
    }

    if (!clipped) break; // truly degenerate; stop rather than loop forever
  }

  if (indices.length === 3) triangles.push([indices[0], indices[1], indices[2]]);
  else if (indices.length > 3) {
    // Last-resort fan so we never return a partial result.
    for (let i = 1; i < indices.length - 1; i++) {
      triangles.push([indices[0], indices[i], indices[i + 1]]);
    }
  }

  return triangles.filter((t) => {
    const area = polygonArea([vertices[t[0]], vertices[t[1]], vertices[t[2]]]);
    return Math.abs(area) > 1e-6;
  });
}

/** Convenience wrapper returning triangles as point arrays. */
export function triangulatePoints(vertices) {
  return triangulate(vertices).map((t) => [vertices[t[0]], vertices[t[1]], vertices[t[2]]]);
}

export function triangleCentroid(triangle) {
  return {
    x: (triangle[0].x + triangle[1].x + triangle[2].x) / 3,
    y: (triangle[0].y + triangle[1].y + triangle[2].y) / 3,
  };
}

export function triangleArea(triangle) {
  return Math.abs(polygonArea(triangle));
}

/**
 * Subdivide a polygon into smaller triangles.
 *
 * `iterations` = 0 returns the plain triangulation (n - 2 faces). Each extra
 * iteration splits every triangle into three by its centroid. Because the
 * centroid of a triangle always lies inside it, generated faces never escape
 * the original polygon and never overlap or leave gaps.
 */
export function subdividePolygon(vertices, iterations = 0) {
  let triangles = triangulatePoints(vertices);
  const steps = Math.max(0, Math.floor(iterations));
  for (let step = 0; step < steps; step++) {
    const next = [];
    for (const tri of triangles) {
      const c = triangleCentroid(tri);
      next.push([tri[0], tri[1], c]);
      next.push([tri[1], tri[2], c]);
      next.push([tri[2], tri[0], c]);
    }
    triangles = next;
  }
  return triangles;
}

/** Number of faces the subdivision would produce for a given iteration count. */
export function subdivisionFaceCount(vertexCount, iterations = 0) {
  const base = Math.max(0, vertexCount - 2);
  return base * Math.pow(3, Math.max(0, Math.floor(iterations)));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Average colour contribution of a triangle is handled in sampling.js. */
