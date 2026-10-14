/**
 * Data model for the editor.
 *
 * The application state is deliberately split into three independent parts:
 *   - `image`    : the imported source image (never modified)
 *   - `polygons` : the artwork geometry + styling, in image coordinates
 *   - `view`     : purely visual state (zoom, pan, display toggles)
 *
 * Only `polygons` (and the selected ids) participate in undo/redo.
 */

let idCounter = 0;

export function nextId(prefix = 'poly') {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

export function createPolygon(vertices, options = {}) {
  return {
    id: options.id || nextId(),
    vertices: vertices.map((p) => ({ x: p.x, y: p.y })),
    fill: options.fill || '#888888',
    opacity: options.opacity === undefined ? 1 : clamp01(options.opacity),
    visible: options.visible === undefined ? true : !!options.visible,
    name: options.name || '',
    texture: options.texture ? { ...options.texture } : null,
    meta: options.meta ? { ...options.meta } : {},
  };
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

export function clonePolygon(polygon) {
  return {
    ...polygon,
    vertices: polygon.vertices.map((p) => ({ x: p.x, y: p.y })),
    texture: polygon.texture ? { ...polygon.texture } : null,
    meta: polygon.meta ? structuredCloneSafe(polygon.meta) : {},
  };
}

export function clonePolygons(polygons) {
  return polygons.map(clonePolygon);
}

function structuredCloneSafe(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

export function createDefaultSettings() {
  return {
    xray: false, // hide all polygon fills, keep geometry + outlines
    showOutlines: true,
    outlineColor: '#ffffff',
    outlineWidth: 2,
    showVertices: true,
    highlightSelection: true,
    overlayOpacity: 1, // global multiplier applied to polygon alpha
    backgroundVisible: true,
  };
}

export function createViewState() {
  return {
    scale: 1,
    tx: 0,
    ty: 0,
  };
}

/**
 * Serialise the editable project (polygons + settings). The image is stored
 * separately as a data URL by the project module.
 */
export function serializePolygons(polygons) {
  return polygons.map((p) => ({
    id: p.id,
    vertices: p.vertices.map((v) => ({ x: round(v.x), y: round(v.y) })),
    fill: p.fill,
    opacity: p.opacity,
    visible: p.visible,
    name: p.name,
    texture: p.texture ? { ...p.texture } : null,
    meta: p.meta || {},
  }));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
