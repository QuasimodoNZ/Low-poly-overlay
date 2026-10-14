/**
 * Low-Poly Image Overlay Editor — application entry point.
 *
 * Responsibilities:
 *  - hold application state (image / polygons / view / settings / tool)
 *  - translate pointer + keyboard input into state changes
 *  - keep the renderer and the properties panel in sync
 *  - expose imports, exports, project save/load and history
 *
 * All geometry is stored in original-image coordinates; the renderer only ever
 * applies a view transform on top of it.
 */

import {
  createPolygon,
  clonePolygon,
  clonePolygons,
  createDefaultSettings,
  nextId,
} from './model.js';
import { History } from './history.js';
import { Renderer, HIT_RADIUS } from './renderer.js';
import {
  pointInPolygon,
  closestEdge,
  closestPointOnSegment,
  isSimplePolygon,
  polygonArea,
  polygonBounds,
  subdividePolygon,
  subdivisionFaceCount,
  clamp,
} from './geometry.js';
import {
  averageColorRGB,
  averageColorLab,
  hexToRgb,
  rgbToHex,
  isValidHex,
  sampleComposite,
  getPixel,
} from './sampling.js';
import { createImageState } from './imageState.js';
import { Magnifier } from './magnifier.js';
import {
  renderCompositeCanvas,
  drawPolygonsToContext,
  createCanvas,
  polygonsToSVGString,
  downloadBlob,
  downloadText,
  canvasToBlob,
  exportStem,
} from './exporter.js';
import {
  serializeProject,
  projectToJSON,
  parseProject,
  loadImageFromFile,
  loadImageFromDataUrl,
} from './project.js';

/* ------------------------------------------------------------------ */
/* DOM helpers                                                        */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* Application state                                                  */
/* ------------------------------------------------------------------ */

const DEFAULT_FILL = '#8a8f98';
const POINT_HIT_PX = 10; // screen px radius for vertex/edge hit-testing

const state = {
  image: null, // image state object (see imageState.js)
  polygons: [],
  selection: [],
  selectedVertex: null,
  view: { scale: 1, tx: 0, ty: 0 },
  settings: createDefaultSettings(),
  tool: 'select',
  eyedropperMode: 'original',
  drawing: null, // { vertices: [{x,y}] } unfinished polygon
  cursorImage: null,
  hoverVertex: null,
  hoverEdge: null,
  subdivision: { iterations: 0, colorMode: 'inherit', preview: null },
  eyedropperPreview: null, // { polygonId, originalFill }
  drag: null,
};

const history = new History(90);

/* ------------------------------------------------------------------ */
/* Element references                                                 */
/* ------------------------------------------------------------------ */

const els = {};
let renderer = null;
let magnifier = null;
let viewInitialised = false;

function cacheElements() {
  const ids = [
    'workspace', 'stage', 'magnifier', 'status',
    'tool-select', 'tool-draw', 'tool-eyedropper', 'tool-pan',
    'btn-undo', 'btn-redo', 'btn-import', 'file-input',
    'btn-fit', 'btn-zoom-in', 'btn-zoom-out', 'zoom-label', 'image-label',
    'chk-xray',
    'btn-export', 'btn-save-project', 'btn-load-project', 'project-input',
    'btn-help', 'help-modal', 'btn-help-close',
    'no-selection', 'selection-panel',
    'fill-color', 'fill-hex', 'fill-r', 'fill-g', 'fill-b',
    'opacity-range', 'opacity-number',
    'btn-avg-rgb', 'btn-avg-lab',
    'btn-front', 'btn-back', 'btn-raise', 'btn-lower', 'btn-delete',
    'polygon-list', 'polygon-count',
    'subdiv-range', 'subdiv-faces', 'subdiv-color-mode',
    'btn-subdiv-preview', 'btn-subdiv-apply', 'btn-subdiv-cancel',
    'btn-texture-load', 'texture-input', 'texture-scale', 'texture-scale-value',
    'texture-offset-x', 'texture-offset-y', 'btn-texture-clear',
    'chk-outlines', 'outline-color', 'outline-width',
    'chk-vertices', 'chk-highlight', 'overlay-opacity', 'overlay-opacity-value',
    'chk-bg', 'chk-autocolor', 'default-fill',
    'eye-options', 'eye-mode-original', 'eye-mode-composite', 'eye-zoom',
    'export-modal', 'btn-export-close', 'export-scale', 'export-respect-visibility',
    'btn-export-composite', 'btn-export-polygons', 'btn-export-original',
    'btn-export-svg', 'btn-export-svg-image', 'btn-export-project',
  ];
  for (const id of ids) els[id] = $(id);
}

/* ------------------------------------------------------------------ */
/* History                                                            */
/* ------------------------------------------------------------------ */

function snapshot() {
  return {
    polygons: clonePolygons(state.polygons),
    selection: [...state.selection],
  };
}

function recordHistory() {
  history.record(snapshot());
  updateHistoryButtons();
}

function restoreSnapshot(snap) {
  state.polygons = clonePolygons(snap.polygons);
  state.selection = [...snap.selection];
  state.selectedVertex = null;
  state.subdivision.preview = null;
  render();
}

function updateHistoryButtons() {
  els['btn-undo'].disabled = !history.canUndo();
  els['btn-redo'].disabled = !history.canRedo();
}

function undo() {
  const previous = history.undo(snapshot());
  if (previous) restoreSnapshot(previous);
  updateHistoryButtons();
}

function redo() {
  const next = history.redo(snapshot());
  if (next) restoreSnapshot(next);
  updateHistoryButtons();
}

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */

function render() {
  if (!renderer) return;
  els.workspace.classList.toggle('has-image', !!state.image);
  renderer.setView(state.view);
  renderer.setImage(state.image, state.settings);
  renderer.clearTexturePatterns();
  renderer.renderPolygons(state.polygons, state.settings, state.selection);
  renderer.renderDrawing(state.tool === 'draw' ? state.drawing : null, state.cursorImage);
  renderer.renderSubdivisionPreview(state.subdivision.preview);
  renderer.renderHandles(state.polygons, state.settings, state.view, {
    selection: state.selection,
    selectedVertex: state.selectedVertex,
    hoverVertex: state.hoverVertex,
    hoverEdge: state.hoverEdge,
    drawing: state.tool === 'draw' ? state.drawing : null,
  });
  updateViewLabels();
}

function updateViewLabels() {
  els['zoom-label'].textContent = `${Math.round(state.view.scale * 100)}%`;
  if (state.image) {
    els['image-label'].textContent = `${state.image.name} · ${state.image.width}×${state.image.height}`;
  } else {
    els['image-label'].textContent = 'No image loaded';
  }
}

function setStatus(message, tone = 'info') {
  els.status.textContent = message;
  els.status.dataset.tone = tone;
}

/* ------------------------------------------------------------------ */
/* View transform                                                     */
/* ------------------------------------------------------------------ */

function workspaceSize() {
  const rect = els.workspace.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function screenFromEvent(event) {
  const rect = els.stage.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function screenToImage(screen) {
  return {
    x: (screen.x - state.view.tx) / state.view.scale,
    y: (screen.y - state.view.ty) / state.view.scale,
  };
}

function fitView() {
  if (!state.image) return;
  const { width, height } = workspaceSize();
  const padding = 40;
  const scale = Math.min(
    (width - padding) / state.image.width,
    (height - padding) / state.image.height,
  );
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  state.view.scale = safeScale;
  state.view.tx = (width - state.image.width * safeScale) / 2;
  state.view.ty = (height - state.image.height * safeScale) / 2;
  render();
}

function zoomAt(screen, factor) {
  const before = screenToImage(screen);
  state.view.scale = clamp(state.view.scale * factor, 0.02, 64);
  state.view.tx = screen.x - before.x * state.view.scale;
  state.view.ty = screen.y - before.y * state.view.scale;
  render();
}

/* ------------------------------------------------------------------ */
/* Image import                                                       */
/* ------------------------------------------------------------------ */

async function importImageFile(file) {
  try {
    const { img, dataUrl } = await loadImageFromFile(file);
    applyImage(img, dataUrl, file.name);
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function applyImage(img, dataUrl, name, { resetPolygons = false } = {}) {
  if (!resetPolygons && state.polygons.length > 0) {
    const proceed = window.confirm(
      'Importing a new image will replace the current artwork. Continue? (Export or save your project first if you want to keep it.)',
    );
    if (!proceed) return;
  }

  state.image = createImageState(img, dataUrl, name);
  if (resetPolygons || state.polygons.length > 0) {
    // Coordinates are tied to the image, so a new image starts a fresh project.
    state.polygons = [];
    state.selection = [];
  }
  state.drawing = null;
  state.selectedVertex = null;
  history.reset();
  updateHistoryButtons();
  fitView();
  render();
  renderPanel();
  setStatus(`Loaded ${name} (${state.image.width}×${state.image.height})`, 'ok');
}

/* ------------------------------------------------------------------ */
/* Selection helpers                                                  */
/* ------------------------------------------------------------------ */

function getSelectedPolygon() {
  if (state.selection.length !== 1) return null;
  return state.polygons.find((p) => p.id === state.selection[0]) || null;
}

function selectPolygon(id, additive = false) {
  if (id === null) {
    state.selection = [];
  } else if (additive) {
    state.selection = state.selection.includes(id)
      ? state.selection.filter((x) => x !== id)
      : [...state.selection, id];
  } else {
    state.selection = [id];
  }
  state.selectedVertex = null;
  render();
  renderPanel();
}

/* ------------------------------------------------------------------ */
/* Polygon creation / editing                                         */
/* ------------------------------------------------------------------ */

function defaultFillForPolygon(vertices) {
  if (els['chk-autocolor']?.checked && state.image?.imageData) {
    const avg = averageColorRGB(state.image.imageData, vertices);
    if (avg) return rgbToHex(avg);
  }
  return els['default-fill']?.value || DEFAULT_FILL;
}

function finishDrawing() {
  const drawing = state.drawing;
  if (!drawing || drawing.vertices.length < 3) {
    setStatus('A polygon needs at least 3 vertices', 'error');
    return;
  }
  if (!isSimplePolygon(drawing.vertices)) {
    setStatus('Polygon edges cross each other — shape rejected', 'error');
    return;
  }

  recordHistory();
  const polygon = createPolygon(drawing.vertices, {
    fill: defaultFillForPolygon(drawing.vertices),
    opacity: 1,
  });
  state.polygons.push(polygon);
  state.drawing = null;
  state.selection = [polygon.id];
  render();
  renderPanel();
  setStatus(`Polygon created (${polygon.vertices.length} vertices)`, 'ok');
}

function cancelDrawing() {
  if (!state.drawing) return;
  state.drawing = null;
  state.cursorImage = null;
  render();
  setStatus('Drawing cancelled');
}

function deleteSelected() {
  // Delete a single vertex first when one is selected.
  if (state.selectedVertex) {
    const { polygonId, index } = state.selectedVertex;
    const polygon = state.polygons.find((p) => p.id === polygonId);
    if (polygon) {
      if (polygon.vertices.length <= 3) {
        setStatus('A polygon must keep at least 3 vertices', 'error');
        return;
      }
      // Validate a copy first so an invalid removal never touches the real
      // geometry or the undo stacks.
      const candidate = polygon.vertices.filter((_, i) => i !== index);
      if (!isSimplePolygon(candidate)) {
        setStatus('That vertex cannot be removed — it would break the polygon', 'error');
        return;
      }
      recordHistory();
      polygon.vertices = candidate;
      state.selectedVertex = null;
      render();
      renderPanel();
      setStatus('Vertex deleted', 'ok');
      return;
    }
  }

  if (state.selection.length === 0) return;
  recordHistory();
  const removing = new Set(state.selection);
  state.polygons = state.polygons.filter((p) => !removing.has(p.id));
  state.selection = [];
  render();
  renderPanel();
  setStatus(`Deleted ${removing.size} polygon${removing.size > 1 ? 's' : ''}`, 'ok');
}

function reorderSelection(mode) {
  const selected = state.selection.slice();
  if (selected.length === 0) return;
  recordHistory();

  if (mode === 'front' || mode === 'back') {
    const chosen = state.polygons.filter((p) => selected.includes(p.id));
    const rest = state.polygons.filter((p) => !selected.includes(p.id));
    state.polygons = mode === 'front' ? [...rest, ...chosen] : [...chosen, ...rest];
  } else {
    const delta = mode === 'raise' ? 1 : -1;
    const order = state.selection
      .map((id) => state.polygons.findIndex((p) => p.id === id))
      .sort((a, b) => (delta > 0 ? b - a : a - b));
    for (const index of order) {
      const target = index + delta;
      if (target < 0 || target >= state.polygons.length) continue;
      if (selected.includes(state.polygons[target].id)) continue;
      [state.polygons[index], state.polygons[target]] = [state.polygons[target], state.polygons[index]];
    }
  }

  render();
  renderPanel();
}

/* ------------------------------------------------------------------ */
/* Pointer interaction                                                */
/* ------------------------------------------------------------------ */

let panState = null;

// Double-click detection is done here rather than with the browser's `dblclick`
// event: rendering replaces DOM nodes between the two clicks, which makes some
// browsers suppress the synthetic event entirely. A time + distance test on
// consecutive presses is deterministic everywhere.
let lastPress = { time: 0, x: 0, y: 0 };
const DOUBLE_PRESS_MS = 320;
const DOUBLE_PRESS_PX = 6;

function isDoublePress(screen) {
  const now = performance.now();
  const isDouble =
    now - lastPress.time < DOUBLE_PRESS_MS &&
    Math.hypot(screen.x - lastPress.x, screen.y - lastPress.y) < DOUBLE_PRESS_PX;
  lastPress = { time: now, x: screen.x, y: screen.y };
  return isDouble;
}

function pointerDown(event) {
  if (!state.image) {
    if (event.button === 0) els['file-input'].click();
    return;
  }

  const screen = screenFromEvent(event);
  const imagePoint = screenToImage(screen);
  els.stage.setPointerCapture?.(event.pointerId);

  // Middle mouse (or pan tool / space) always pans, regardless of tool.
  if (event.button === 1 || state.tool === 'pan' || event.altKey) {
    panState = { startX: event.clientX, startY: event.clientY, tx: state.view.tx, ty: state.view.ty };
    els.stage.classList.add('panning');
    return;
  }

  if (event.button !== 0) return;

  const doublePress = isDoublePress(screen);

  if (state.tool === 'draw') {
    handleDrawClick(imagePoint, screen, { doublePress });
    return;
  }

  if (state.tool === 'eyedropper') {
    commitEyedropper(imagePoint);
    return;
  }

  if (state.tool === 'select') {
    handleSelectPress(imagePoint, screen, event, { doublePress });
  }
}

function handleDrawClick(imagePoint, screen, options = {}) {
  if (!state.drawing) {
    state.drawing = { vertices: [{ ...imagePoint }] };
    setStatus('Click to add vertices · click the first point, double-click or press Enter to close · Esc cancels');
    render();
    return;
  }

  // Double-click closes the polygon.
  if (options.doublePress && state.drawing.vertices.length >= 3) {
    finishDrawing();
    return;
  }

  const first = state.drawing.vertices[0];
  const firstScreen = {
    x: first.x * state.view.scale + state.view.tx,
    y: first.y * state.view.scale + state.view.ty,
  };
  const distToFirst = Math.hypot(screen.x - firstScreen.x, screen.y - firstScreen.y);

  if (state.drawing.vertices.length >= 3 && distToFirst <= POINT_HIT_PX + 2) {
    finishDrawing();
    return;
  }

  const last = state.drawing.vertices[state.drawing.vertices.length - 1];
  if (Math.hypot(last.x - imagePoint.x, last.y - imagePoint.y) * state.view.scale < 1.5) return;

  state.drawing.vertices.push({ ...imagePoint });
  render();
}

function handleSelectPress(imagePoint, screen, event, options = {}) {
  const additive = event.shiftKey;

  // 0) Double-clicking an edge inserts a vertex there (a double-click on an
  //    existing vertex is ignored so we never create a degenerate sliver).
  if (options.doublePress) {
    if (hitTestVertex(imagePoint)) return;
    const edgeHit = hitTestEdge(imagePoint, null);
    if (edgeHit) {
      insertVertex(edgeHit.polygonId, edgeHit.index, imagePoint);
      return;
    }
  }

  // 1) Vertex drag on a selected polygon.
  const vertexHit = hitTestVertex(imagePoint);
  if (vertexHit) {
    selectPolygon(vertexHit.polygonId, false);
    state.selectedVertex = { polygonId: vertexHit.polygonId, index: vertexHit.index };
    state.drag = {
      type: 'vertex',
      polygonId: vertexHit.polygonId,
      index: vertexHit.index,
      recorded: false,
      start: { ...imagePoint },
    };
    render();
    renderPanel();
    return;
  }

  // 2) Polygon body: select and prepare to move.
  const polygon = renderer.hitTestPolygons(state.polygons, imagePoint);
  if (polygon) {
    if (!state.selection.includes(polygon.id)) selectPolygon(polygon.id, additive);
    state.selectedVertex = null;
    state.drag = { type: 'move', polygonId: polygon.id, recorded: false, additive, start: { ...imagePoint } };
    render();
    return;
  }

  // 3) Empty space clears the selection.
  if (!additive) selectPolygon(null);
}

function hitTestVertex(imagePoint) {
  const candidates = state.selection.length
    ? state.polygons.filter((p) => state.selection.includes(p.id))
    : state.polygons;
  let best = null;
  let bestDist = HIT_RADIUS;
  for (const polygon of candidates) {
    polygon.vertices.forEach((vertex, index) => {
      const dist = Math.hypot(vertex.x - imagePoint.x, vertex.y - imagePoint.y) * state.view.scale;
      if (dist <= bestDist) {
        bestDist = dist;
        best = { polygonId: polygon.id, index };
      }
    });
  }
  return best;
}

function hitTestEdge(imagePoint, restrictToId) {
  let best = null;
  let bestDist = HIT_RADIUS;
  for (const polygon of state.polygons) {
    if (restrictToId && polygon.id !== restrictToId) continue;
    const hit = closestEdge(imagePoint, polygon.vertices);
    const dist = hit.distance * state.view.scale;
    if (dist <= bestDist) {
      bestDist = dist;
      best = { polygonId: polygon.id, index: hit.index, point: hit.point };
    }
  }
  return best;
}

function insertVertex(polygonId, edgeIndex, imagePoint) {
  const polygon = state.polygons.find((p) => p.id === polygonId);
  if (!polygon) return;
  const edge = closestPointOnSegment(imagePoint, polygon.vertices[edgeIndex], polygon.vertices[(edgeIndex + 1) % polygon.vertices.length]);

  const candidate = polygon.vertices.slice();
  candidate.splice(edgeIndex + 1, 0, { x: edge.point.x, y: edge.point.y });
  if (!isSimplePolygon(candidate)) {
    setStatus('A vertex cannot be added there — it would make the polygon invalid', 'error');
    return;
  }

  recordHistory();
  polygon.vertices = candidate;
  state.selection = [polygonId];
  state.selectedVertex = { polygonId, index: edgeIndex + 1 };
  render();
  renderPanel();
  setStatus('Vertex added', 'ok');
}

function pointerMove(event) {
  const screen = screenFromEvent(event);
  const imagePoint = screenToImage(screen);

  if (panState) {
    state.view.tx = panState.tx + (event.clientX - panState.startX);
    state.view.ty = panState.ty + (event.clientY - panState.startY);
    render();
    return;
  }

  if (state.drag) {
    applyDrag(imagePoint);
    return;
  }

  state.cursorImage = imagePoint;

  if (state.tool === 'draw') {
    state.hoverVertex = null;
    state.hoverEdge = null;
    render();
    return;
  }

  if (state.tool === 'eyedropper') {
    updateEyedropperHover(imagePoint, screen);
    return;
  }

  if (state.tool === 'select') {
    state.hoverVertex = hitTestVertex(imagePoint);
    state.hoverEdge = state.hoverVertex ? null : hitTestEdge(imagePoint, getSelectedPolygon()?.id || null);
    render();
  }
}

function applyDrag(imagePoint) {
  const drag = state.drag;
  const polygon = state.polygons.find((p) => p.id === drag.polygonId);
  if (!polygon) return;

  // Ignore sub-threshold movement so a click to select never nudges geometry.
  if (!drag.recorded) {
    const start = drag.start || imagePoint;
    const moved = Math.hypot(imagePoint.x - start.x, imagePoint.y - start.y) * state.view.scale;
    if (moved < 3) return;
  }

  if (!drag.recorded) {
    recordHistory();
    drag.recorded = true;
    drag.last = { ...imagePoint };
    if (drag.type === 'vertex') {
      drag.originalVertices = polygon.vertices.map((v) => ({ ...v }));
    }
  }

  if (drag.type === 'vertex') {      const base = drag.originalVertices[drag.index];
      polygon.vertices[drag.index] = { x: imagePoint.x, y: imagePoint.y };
      // Guard against the drag creating a self-intersection.
      if (!isSimplePolygon(polygon.vertices) || Math.abs(polygonArea(polygon.vertices)) < 0.5) {
        polygon.vertices[drag.index] = { ...base };
      } else {
        drag.position = { x: imagePoint.x, y: imagePoint.y };
      }
  } else if (drag.type === 'move') {
    const delta = { x: imagePoint.x - drag.last.x, y: imagePoint.y - drag.last.y };
    drag.last = { ...imagePoint };
    for (const id of state.selection) {
      const p = state.polygons.find((q) => q.id === id);
      if (!p) continue;
      for (const vertex of p.vertices) {
        vertex.x += delta.x;
        vertex.y += delta.y;
      }
    }
  }

  render();
}

function pointerUp(event) {
  if (panState) {
    panState = null;
    els.stage.classList.remove('panning');
  }
  if (state.drag) {
    state.drag = null;
    renderPanel();
    render();
  }
  els.stage.releasePointerCapture?.(event.pointerId);
}

/* ------------------------------------------------------------------ */
/* Eyedropper                                                         */
/* ------------------------------------------------------------------ */

function sampleAt(imagePoint, mode) {
  if (!state.image) return null;

  if (mode === 'composite') {
    const background =
      state.settings.backgroundVisible && state.image.imageData
        ? getPixel(state.image.imageData, imagePoint.x, imagePoint.y)
        : null;
    const polygons = state.settings.xray ? [] : state.polygons;
    const color = sampleComposite(imagePoint, polygons, background, state.settings.overlayOpacity);
    return { ...color, hex: rgbToHex(color) };
  }

  if (!state.image.imageData) return null;
  const pixel = getPixel(state.image.imageData, imagePoint.x, imagePoint.y);
  if (!pixel) return null;
  const opaque = { r: pixel.r, g: pixel.g, b: pixel.b, a: pixel.a };
  return { ...opaque, hex: rgbToHex(opaque) };
}

function updateEyedropperHover(imagePoint, screen) {
  const sample = sampleAt(imagePoint, state.eyedropperMode);

  magnifier.show(
    imagePoint,
    state.image,
    sample
      ? { hex: sample.hex, mode: state.eyedropperMode === 'composite' ? 'composite' : 'image' }
      : { mode: 'no image data' },
    screen,
  );

  // Live preview on the selected polygon (restored on cancel).
  const polygon = getSelectedPolygon();
  if (polygon && sample) {
    if (!state.eyedropperPreview || state.eyedropperPreview.polygonId !== polygon.id) {
      state.eyedropperPreview = { polygonId: polygon.id, originalFill: polygon.fill };
    }
    const current = hexToRgb(polygon.fill);
    const next = { r: sample.r, g: sample.g, b: sample.b };
    if (!current || current.r !== next.r || current.g !== next.g || current.b !== next.b) {
      polygon.fill = rgbToHex(next);
      render();
      syncColorInputs(polygon);
    }
  }

  state.cursorImage = imagePoint;
}

function cancelEyedropperPreview() {
  if (!state.eyedropperPreview) return;
  const polygon = state.polygons.find((p) => p.id === state.eyedropperPreview.polygonId);
  if (polygon) polygon.fill = state.eyedropperPreview.originalFill;
  state.eyedropperPreview = null;
  render();
}

function commitEyedropper(imagePoint) {
  const polygon = getSelectedPolygon();
  const sample = sampleAt(imagePoint, state.eyedropperMode);

  if (!polygon) {
    setStatus('Select a polygon before using the eyedropper', 'error');
    return;
  }
  if (!sample) {
    setStatus('No colour available at that point', 'error');
    return;
  }

  if (state.eyedropperPreview) {
    // Keep the live colour but record history against the original value.
    polygon.fill = state.eyedropperPreview.originalFill;
    state.eyedropperPreview = null;
  }

  recordHistory();
  polygon.fill = sample.hex;
  render();
  renderPanel();
  setStatus(`Applied ${sample.hex} (${state.eyedropperMode})`, 'ok');
}

/* ------------------------------------------------------------------ */
/* Tools                                                              */
/* ------------------------------------------------------------------ */

function setTool(tool) {
  if (state.tool === 'eyedropper' && tool !== 'eyedropper') {
    cancelEyedropperPreview();
    magnifier.hide();
  }
  if (state.tool === 'draw' && tool !== 'draw') {
    cancelDrawing();
  }
  state.tool = tool;
  state.drag = null;
  state.hoverVertex = null;
  state.hoverEdge = null;
  state.cursorImage = null;

  for (const id of ['tool-select', 'tool-draw', 'tool-eyedropper', 'tool-pan']) {
    els[id].classList.toggle('active', id === `tool-${tool}`);
  }
  els['eye-options'].hidden = tool !== 'eyedropper';
  els.workspace.dataset.tool = tool;
  render();
  setStatus(
    {
      select: 'Select: click to select, drag to move, drag a vertex to reshape, double-click an edge to add a vertex',
      draw: 'Draw: click to place vertices',
      eyedropper: 'Eyedropper: click to sample a colour onto the selected polygon',
      pan: 'Pan: drag to move the view',
    }[tool] || '',
  );
}

/* ------------------------------------------------------------------ */
/* Colour / opacity                                                   */
/* ------------------------------------------------------------------ */

function applyFill(polygon, hex) {
  polygon.fill = hex;
  render();
}

function onColorInput(hex, { record = true } = {}) {
  const polygon = getSelectedPolygon();
  if (!polygon || !isValidHex(hex)) return;
  if (record) recordHistory();
  applyFill(polygon, hex);
  syncColorInputs(polygon);
  renderPanel();
}

function onOpacityInput(value, { record = true } = {}) {
  const polygon = getSelectedPolygon();
  if (!polygon) return;
  if (record) recordHistory();
  polygon.opacity = clamp(Number(value), 0, 1);
  render();
  renderPanel();
}

function sampleSelectedAverage(mode) {
  const polygon = getSelectedPolygon();
  if (!polygon) return;
  if (!state.image?.imageData) {
    setStatus('Colour sampling needs an imported image', 'error');
    return;
  }
  const avg = mode === 'lab'
    ? averageColorLab(state.image.imageData, polygon.vertices)
    : averageColorRGB(state.image.imageData, polygon.vertices);
  if (!avg) {
    setStatus('No image pixels found inside this polygon', 'error');
    return;
  }
  recordHistory();
  polygon.fill = rgbToHex(avg);
  render();
  renderPanel();
  setStatus(`Average colour (${mode === 'lab' ? 'CIELAB' : 'RGB'}) applied`, 'ok');
}

/* ------------------------------------------------------------------ */
/* Subdivision                                                        */
/* ------------------------------------------------------------------ */

function updateSubdivisionPreview() {
  const polygon = getSelectedPolygon();
  state.subdivision.preview = null;
  if (!polygon || !els['subdiv-range'].value) {
    renderer.renderSubdivisionPreview(null);
    return;
  }
  try {
    const triangles = subdividePolygon(polygon.vertices, state.subdivision.iterations);
    state.subdivision.preview = triangles;
    renderer.renderSubdivisionPreview(triangles);
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function applySubdivision() {
  const polygon = getSelectedPolygon();
  if (!polygon) return;
  if (state.subdivision.iterations <= 0) {
    setStatus('Increase the subdivision density before applying', 'error');
    return;
  }

  let triangles;
  try {
    triangles = subdividePolygon(polygon.vertices, state.subdivision.iterations);
  } catch (error) {
    setStatus(error.message, 'error');
    return;
  }
  if (triangles.length === 0) {
    setStatus('Subdivision produced no faces', 'error');
    return;
  }

  recordHistory();
  const index = state.polygons.findIndex((p) => p.id === polygon.id);
  const colorMode = state.subdivision.colorMode;

  const faces = triangles.map((tri) => {
    let fill = polygon.fill;
    if (colorMode !== 'inherit' && state.image?.imageData) {
      const avg = colorMode === 'lab'
        ? averageColorLab(state.image.imageData, tri)
        : averageColorRGB(state.image.imageData, tri);
      if (avg) fill = rgbToHex(avg);
    }
    return createPolygon(tri, { fill, opacity: polygon.opacity, visible: polygon.visible });
  });

  state.polygons.splice(index, 1, ...faces);
  state.selection = faces.map((f) => f.id);
  state.subdivision.preview = null;
  state.subdivision.iterations = 0;
  els['subdiv-range'].value = '0';
  render();
  renderPanel();
  setStatus(`Subdivided into ${faces.length} faces`, 'ok');
}

/* ------------------------------------------------------------------ */
/* Texture                                                            */
/* ------------------------------------------------------------------ */

async function applyTextureFile(file) {
  const polygon = getSelectedPolygon();
  if (!polygon) {
    setStatus('Select a polygon before applying a texture', 'error');
    return;
  }
  try {
    const { img, dataUrl } = await loadImageFromFile(file);
    recordHistory();
    polygon.texture = {
      href: dataUrl,
      image: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      scale: Number(els['texture-scale'].value) || 1,
      offsetX: Number(els['texture-offset-x'].value) || 0,
      offsetY: Number(els['texture-offset-y'].value) || 0,
    };
    render();
    renderPanel();
    setStatus('Texture applied', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function updateTextureSetting(key, value) {
  const polygon = getSelectedPolygon();
  if (!polygon || !polygon.texture) return;
  polygon.texture[key] = value;
  render();
}

/* ------------------------------------------------------------------ */
/* Display settings                                                   */
/* ------------------------------------------------------------------ */

function bindDisplaySettings() {
  els['chk-xray'].addEventListener('change', () => {
    state.settings.xray = els['chk-xray'].checked;
    render();
    setStatus(state.settings.xray ? 'X-ray mode: fills hidden, outlines kept' : 'X-ray mode off');
  });
  els['chk-outlines'].addEventListener('change', () => {
    state.settings.showOutlines = els['chk-outlines'].checked;
    render();
  });
  els['outline-color'].addEventListener('input', () => {
    state.settings.outlineColor = els['outline-color'].value;
    render();
  });
  els['outline-width'].addEventListener('input', () => {
    state.settings.outlineWidth = Number(els['outline-width'].value);
    render();
  });
  els['chk-vertices'].addEventListener('change', () => {
    state.settings.showVertices = els['chk-vertices'].checked;
    render();
  });
  els['chk-highlight'].addEventListener('change', () => {
    state.settings.highlightSelection = els['chk-highlight'].checked;
    render();
  });
  els['overlay-opacity'].addEventListener('input', () => {
    state.settings.overlayOpacity = Number(els['overlay-opacity'].value);
    els['overlay-opacity-value'].textContent = `${Math.round(state.settings.overlayOpacity * 100)}%`;
    render();
  });
  els['chk-bg'].addEventListener('change', () => {
    state.settings.backgroundVisible = els['chk-bg'].checked;
    render();
  });
}

/* ------------------------------------------------------------------ */
/* Properties panel                                                   */
/* ------------------------------------------------------------------ */

function syncColorInputs(polygon) {
  const rgb = hexToRgb(polygon.fill) || { r: 0, g: 0, b: 0 };
  els['fill-color'].value = polygon.fill;
  els['fill-hex'].value = polygon.fill;
  if (document.activeElement !== els['fill-r']) els['fill-r'].value = rgb.r;
  if (document.activeElement !== els['fill-g']) els['fill-g'].value = rgb.g;
  if (document.activeElement !== els['fill-b']) els['fill-b'].value = rgb.b;
}

function renderPolygonList() {
  els['polygon-count'].textContent = String(state.polygons.length);
  const fragment = document.createDocumentFragment();
  // Reverse order so the top-most polygon (last drawn) is at the top of the list.
  for (let i = state.polygons.length - 1; i >= 0; i--) {
    const polygon = state.polygons[i];
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'polygon-item';
    item.dataset.id = polygon.id;
    if (state.selection.includes(polygon.id)) item.classList.add('selected');

    const swatch = document.createElement('span');
    swatch.className = 'polygon-swatch';
    swatch.style.background = polygon.fill;
    if (polygon.texture) swatch.style.backgroundImage = `url(${polygon.texture.href})`;

    const label = document.createElement('span');
    label.className = 'polygon-item-label';
    label.textContent = `#${i + 1} · ${polygon.vertices.length}v`;

    if (polygon.visible === false) item.classList.add('hidden-polygon');

    item.append(swatch, label);
    item.addEventListener('click', (event) => selectPolygon(polygon.id, event.shiftKey));
    fragment.append(item);
  }
  els['polygon-list'].replaceChildren(fragment);
}

function renderPanel() {
  const polygon = getSelectedPolygon();
  els['no-selection'].hidden = !!polygon;
  els['selection-panel'].hidden = !polygon;

  if (polygon) {
    syncColorInputs(polygon);
    const percent = Math.round(polygon.opacity * 100);
    // The slider and the number input are both 0-100 (percent).
    if (document.activeElement !== els['opacity-range']) els['opacity-range'].value = String(percent);
    if (document.activeElement !== els['opacity-number']) els['opacity-number'].value = String(percent);

    const iterations = state.subdivision.iterations;
    els['subdiv-faces'].textContent = `${subdivisionFaceCount(polygon.vertices.length, iterations)} faces`;
    const hasTexture = !!polygon.texture;
    els['texture-scale'].disabled = !hasTexture;
    els['texture-offset-x'].disabled = !hasTexture;
    els['texture-offset-y'].disabled = !hasTexture;
    els['btn-texture-clear'].disabled = !hasTexture;
    if (hasTexture) {
      els['texture-scale'].value = String(polygon.texture.scale || 1);
      els['texture-scale-value'].textContent = `${(polygon.texture.scale || 1).toFixed(2)}×`;
      els['texture-offset-x'].value = String(polygon.texture.offsetX || 0);
      els['texture-offset-y'].value = String(polygon.texture.offsetY || 0);
    }
  }

  renderPolygonList();
}

/* ------------------------------------------------------------------ */
/* Export                                                             */
/* ------------------------------------------------------------------ */

function exportScale() {
  const value = Number(els['export-scale'].value);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function outputSize() {
  if (!state.image) return { width: 100, height: 100 };
  const scale = exportScale();
  return {
    width: Math.max(1, Math.round(state.image.width * scale)),
    height: Math.max(1, Math.round(state.image.height * scale)),
  };
}

function scalingPolygons(polygons, scale) {
  if (scale === 1) return polygons;
  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map((v) => ({ x: v.x * scale, y: v.y * scale })),
    texture: p.texture
      ? {
          ...p.texture,
          scale: (p.texture.scale || 1) * scale,
          offsetX: (p.texture.offsetX || 0) * scale,
          offsetY: (p.texture.offsetY || 0) * scale,
        }
      : null,
  }));
}

async function exportCompositePNG() {
  if (!state.image) return setStatus('Import an image first', 'error');
  const { width, height } = outputSize();
  const respect = els['export-respect-visibility'].checked;
  const includeBackground = respect ? state.settings.backgroundVisible : true;
  const polygons = scalingPolygons(state.polygons, exportScale());

  const canvas = renderCompositeCanvas(state.image.img, polygons, {
    width,
    height,
    includeBackground,
    includePolygons: true,
    overlayOpacity: respect && state.settings.xray ? 0 : state.settings.overlayOpacity,
  });

  const blob = await canvasToBlob(canvas);
  downloadBlob(blob, `${exportStem(state.image.name)}-composition.png`);
  setStatus('Exported full composition PNG', 'ok');
}

async function exportPolygonPNG() {
  if (!state.image) return setStatus('Import an image first', 'error');
  const { width, height } = outputSize();
  const { canvas, ctx } = createCanvas(width, height);
  drawPolygonsToContext(ctx, scalingPolygons(state.polygons, exportScale()), {
    overlayOpacity: state.settings.overlayOpacity,
  });
  const blob = await canvasToBlob(canvas);
  downloadBlob(blob, `${exportStem(state.image.name)}-polygons.png`);
  setStatus('Exported transparent polygon PNG', 'ok');
}

async function exportOriginalPNG() {
  if (!state.image) return setStatus('Import an image first', 'error');
  const { width, height } = outputSize();
  const { canvas, ctx } = createCanvas(width, height);
  ctx.drawImage(state.image.img, 0, 0, width, height);
  const blob = await canvasToBlob(canvas);
  downloadBlob(blob, `${exportStem(state.image.name)}-original.png`);
  setStatus('Exported original image PNG', 'ok');
}

function exportSVG({ withImage }) {
  if (!state.image) return setStatus('Import an image first', 'error');
  const { width, height } = outputSize();
  const polygons = scalingPolygons(state.polygons, exportScale());
  const svg = polygonsToSVGString(polygons, {
    width,
    height,
    backgroundHref: withImage ? state.image.dataUrl : null,
    includeBackground: withImage,
    includePolygons: true,
    overlayOpacity: state.settings.overlayOpacity,
  });
  const suffix = withImage ? '-with-image' : '';
  downloadText(svg, `${exportStem(state.image.name)}${suffix}.svg`, 'image/svg+xml');
  setStatus(`Exported SVG${withImage ? ' with embedded image' : ''}`, 'ok');
}

function exportProjectFile() {
  const project = serializeProject({
    image: state.image,
    polygons: state.polygons,
    settings: state.settings,
  });
  downloadText(projectToJSON(project), `${exportStem(state.image?.name)}-project.json`, 'application/json');
  setStatus('Project saved', 'ok');
}

async function loadProjectFile(file) {
  try {
    const text = await file.text();
    const project = parseProject(text);

    if (project.image) {
      const img = await loadImageFromDataUrl(project.image.dataUrl);
      // Replace the current project wholesale; confirm only if work exists.
      if (state.polygons.length > 0 && !window.confirm('Load this project and replace the current artwork?')) {
        return;
      }
      state.image = createImageState(img, project.image.dataUrl, project.image.name);
    } else if (state.polygons.length > 0 && !window.confirm('Load this project and replace the current artwork?')) {
      return;
    }

    state.polygons = project.polygons;
    state.settings = project.settings;
    state.selection = [];
    state.drawing = null;
    await hydrateTextures();
    history.reset();
    updateHistoryButtons();
    syncSettingsInputs();
    fitView();
    render();
    renderPanel();
    setStatus(`Project loaded (${state.polygons.length} polygons)`, 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function hydrateTextures() {
  for (const polygon of state.polygons) {
    if (polygon.texture && polygon.texture.href && !polygon.texture.image) {
      try {
        polygon.texture.image = await loadImageFromDataUrl(polygon.texture.href);
      } catch {
        polygon.texture = null;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Settings sync                                                      */
/* ------------------------------------------------------------------ */

function syncSettingsInputs() {
  els['chk-xray'].checked = state.settings.xray;
  els['chk-outlines'].checked = state.settings.showOutlines;
  els['outline-color'].value = state.settings.outlineColor;
  els['outline-width'].value = String(state.settings.outlineWidth);
  els['chk-vertices'].checked = state.settings.showVertices;
  els['chk-highlight'].checked = state.settings.highlightSelection;
  els['overlay-opacity'].value = String(state.settings.overlayOpacity);
  els['overlay-opacity-value'].textContent = `${Math.round(state.settings.overlayOpacity * 100)}%`;
  els['chk-bg'].checked = state.settings.backgroundVisible;
}

/* ------------------------------------------------------------------ */
/* Keyboard shortcuts                                                 */
/* ------------------------------------------------------------------ */

function onKeyDown(event) {
  const target = event.target;
  const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  const meta = event.ctrlKey || event.metaKey;

  if (meta && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (meta && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redo();
    return;
  }
  if (meta && event.key.toLowerCase() === 's') {
    event.preventDefault();
    exportProjectFile();
    return;
  }
  if (meta && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    els['project-input'].click();
    return;
  }

  if (typing) return;

  switch (event.key) {
    case 'v':
    case 'V':
      setTool('select');
      return;
    case 'p':
    case 'P':
      setTool('draw');
      return;
    case 'i':
    case 'I':
      setTool('eyedropper');
      return;
    case 'h':
    case 'H':
      setTool('pan');
      return;
    case 'f':
    case 'F':
      fitView();
      return;
    case '?':
      els['help-modal'].hidden = false;
      return;
    case 'Enter':
      if (state.tool === 'draw' && state.drawing) {
        event.preventDefault();
        finishDrawing();
      }
      return;
    case 'Escape':
      if (state.tool === 'eyedropper') cancelEyedropperPreview();
      if (state.drawing) cancelDrawing();
      if (state.selection.length) selectPolygon(null);
      magnifier.hide();
      return;
    case 'Delete':
    case 'Backspace':
      if (state.selection.length || state.selectedVertex) {
        event.preventDefault();
        deleteSelected();
      }
      return;
    default:
      break;
  }

  if (event.key === '+' || event.key === '=') {
    zoomAt({ x: workspaceSize().width / 2, y: workspaceSize().height / 2 }, 1.2);
  } else if (event.key === '-') {
    zoomAt({ x: workspaceSize().width / 2, y: workspaceSize().height / 2 }, 1 / 1.2);
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                             */
/* ------------------------------------------------------------------ */

function bindToolbar() {
  els['tool-select'].addEventListener('click', () => setTool('select'));
  els['tool-draw'].addEventListener('click', () => setTool('draw'));
  els['tool-eyedropper'].addEventListener('click', () => setTool('eyedropper'));
  els['tool-pan'].addEventListener('click', () => setTool('pan'));

  els['btn-undo'].addEventListener('click', undo);
  els['btn-redo'].addEventListener('click', redo);

  els['btn-import'].addEventListener('click', () => els['file-input'].click());
  els['file-input'].addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) importImageFile(file);
    event.target.value = '';
  });

  els['btn-fit'].addEventListener('click', fitView);
  els['btn-zoom-in'].addEventListener('click', () =>
    zoomAt({ x: workspaceSize().width / 2, y: workspaceSize().height / 2 }, 1.25),
  );
  els['btn-zoom-out'].addEventListener('click', () =>
    zoomAt({ x: workspaceSize().width / 2, y: workspaceSize().height / 2 }, 1 / 1.25),
  );

  els['btn-export'].addEventListener('click', () => {
    els['export-modal'].hidden = false;
  });
  els['btn-export-close'].addEventListener('click', () => {
    els['export-modal'].hidden = true;
  });
  els['btn-export-composite'].addEventListener('click', exportCompositePNG);
  els['btn-export-polygons'].addEventListener('click', exportPolygonPNG);
  els['btn-export-original'].addEventListener('click', exportOriginalPNG);
  els['btn-export-svg'].addEventListener('click', () => exportSVG({ withImage: false }));
  els['btn-export-svg-image'].addEventListener('click', () => exportSVG({ withImage: true }));
  els['btn-export-project'].addEventListener('click', exportProjectFile);

  els['btn-save-project'].addEventListener('click', exportProjectFile);
  els['btn-load-project'].addEventListener('click', () => els['project-input'].click());
  els['project-input'].addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) loadProjectFile(file);
    event.target.value = '';
  });

  els['btn-help'].addEventListener('click', () => {
    els['help-modal'].hidden = !els['help-modal'].hidden;
  });
  els['btn-help-close'].addEventListener('click', () => {
    els['help-modal'].hidden = true;
  });

  els['eye-mode-original'].addEventListener('change', () => {
    state.eyedropperMode = 'original';
  });
  els['eye-mode-composite'].addEventListener('change', () => {
    state.eyedropperMode = 'composite';
  });
  els['eye-zoom'].addEventListener('input', () => {
    magnifier.setZoom(Number(els['eye-zoom'].value));
    if (state.cursorImage) updateEyedropperHover(state.cursorImage, { x: 0, y: 0 });
  });
}

function bindProperties() {
  els['fill-color'].addEventListener('input', () => onColorInput(els['fill-color'].value));
  els['fill-hex'].addEventListener('change', () => {
    if (isValidHex(els['fill-hex'].value)) onColorInput(els['fill-hex'].value);
    else els['fill-hex'].value = getSelectedPolygon()?.fill || '';
  });
  for (const id of ['fill-r', 'fill-g', 'fill-b']) {
    els[id].addEventListener('change', () => {
      const rgb = {
        r: clamp(Number(els['fill-r'].value) || 0, 0, 255),
        g: clamp(Number(els['fill-g'].value) || 0, 0, 255),
        b: clamp(Number(els['fill-b'].value) || 0, 0, 255),
      };
      onColorInput(rgbToHex(rgb));
    });
  }

  els['opacity-range'].addEventListener('input', () => {
    onOpacityInput(Number(els['opacity-range'].value) / 100, { record: false });
    els['opacity-number'].value = els['opacity-range'].value;
  });
  els['opacity-range'].addEventListener('change', () => {
    // Record a single history entry once the slider is released.
    const polygon = getSelectedPolygon();
    if (!polygon) return;
    const value = Number(els['opacity-range'].value) / 100;
    polygon.opacity = clamp(value, 0, 1);
    recordHistory();
    renderPanel();
  });
  els['opacity-number'].addEventListener('change', () => {
    onOpacityInput(Number(els['opacity-number'].value) / 100);
  });

  els['btn-avg-rgb'].addEventListener('click', () => sampleSelectedAverage('rgb'));
  els['btn-avg-lab'].addEventListener('click', () => sampleSelectedAverage('lab'));

  els['btn-front'].addEventListener('click', () => reorderSelection('front'));
  els['btn-back'].addEventListener('click', () => reorderSelection('back'));
  els['btn-raise'].addEventListener('click', () => reorderSelection('raise'));
  els['btn-lower'].addEventListener('click', () => reorderSelection('lower'));
  els['btn-delete'].addEventListener('click', deleteSelected);

  els['subdiv-range'].addEventListener('input', () => {
    state.subdivision.iterations = Number(els['subdiv-range'].value);
    const polygon = getSelectedPolygon();
    if (polygon) {
      els['subdiv-faces'].textContent = `${subdivisionFaceCount(polygon.vertices.length, state.subdivision.iterations)} faces`;
    }
  });
  els['btn-subdiv-preview'].addEventListener('click', () => {
    const polygon = getSelectedPolygon();
    if (!polygon) return;
    try {
      state.subdivision.preview = subdividePolygon(polygon.vertices, state.subdivision.iterations);
      renderer.renderSubdivisionPreview(state.subdivision.preview);
      setStatus(`Previewing ${state.subdivision.preview.length} faces`, 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });
  els['btn-subdiv-cancel'].addEventListener('click', () => {
    state.subdivision.preview = null;
    renderer.renderSubdivisionPreview(null);
  });
  els['btn-subdiv-apply'].addEventListener('click', applySubdivision);
  els['subdiv-color-mode'].addEventListener('change', () => {
    state.subdivision.colorMode = els['subdiv-color-mode'].value;
  });

  els['btn-texture-load'].addEventListener('click', () => els['texture-input'].click());
  els['texture-input'].addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) applyTextureFile(file);
    event.target.value = '';
  });
  els['texture-scale'].addEventListener('input', () => {
    els['texture-scale-value'].textContent = `${Number(els['texture-scale'].value).toFixed(2)}×`;
    updateTextureSetting('scale', Number(els['texture-scale'].value));
  });
  els['texture-offset-x'].addEventListener('input', () =>
    updateTextureSetting('offsetX', Number(els['texture-offset-x'].value)),
  );
  els['texture-offset-y'].addEventListener('input', () =>
    updateTextureSetting('offsetY', Number(els['texture-offset-y'].value)),
  );
  els['btn-texture-clear'].addEventListener('click', () => {
    const polygon = getSelectedPolygon();
    if (!polygon || !polygon.texture) return;
    recordHistory();
    polygon.texture = null;
    render();
    renderPanel();
  });
}

function bindStage() {
  els.stage.addEventListener('pointerdown', pointerDown);
  els.stage.addEventListener('pointermove', pointerMove);
  els.stage.addEventListener('pointerup', pointerUp);
  els.stage.addEventListener('pointercancel', pointerUp);
  els.stage.addEventListener('contextmenu', (event) => {
    if (state.tool === 'eyedropper') {
      event.preventDefault();
      cancelEyedropperPreview();
      magnifier.hide();
      setStatus('Eyedropper cancelled', 'info');
    }
  });
  els.stage.addEventListener('pointerleave', () => {
    state.cursorImage = null;
    magnifier.hide();
    if (state.tool === 'draw') render();
  });

  els.stage.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const screen = screenFromEvent(event);
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAt(screen, factor);
    },
    { passive: false },
  );

  // Drag & drop import.
  const workspace = els.workspace;
  workspace.addEventListener('dragover', (event) => {
    event.preventDefault();
    workspace.classList.add('drag-over');
  });
  workspace.addEventListener('dragleave', () => workspace.classList.remove('drag-over'));
  workspace.addEventListener('drop', (event) => {
    event.preventDefault();
    workspace.classList.remove('drag-over');
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.type === 'application/json' || file.name.endsWith('.json')) loadProjectFile(file);
    else importImageFile(file);
  });
}

function bindWindow() {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', () => {
    // Geometry lives in image space, so a resize never changes the artwork.
    render();
  });
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                          */
/* ------------------------------------------------------------------ */

function init() {
  cacheElements();
  renderer = new Renderer(els.stage);
  magnifier = new Magnifier(els.magnifier, { size: 160, zoom: Number(els['eye-zoom'].value) || 8 });

  bindToolbar();
  bindProperties();
  bindDisplaySettings();
  bindStage();
  bindWindow();

  syncSettingsInputs();
  setTool('select');
  updateHistoryButtons();
  renderPanel();
  render();
  setStatus('Import an image to begin.', 'info');
  void viewInitialised;

  // Small, documented hook used by the browser smoke test (scripts/browser-smoke.mjs).
  window.__lpo = { state, render, setTool, fitView, renderPanel };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { state, render, fitView, setTool };
