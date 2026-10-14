/**
 * SVG renderer.
 *
 * The renderer owns all SVG DOM inside the workspace. Polygons are drawn inside
 * a single `<g>` whose transform maps image coordinates to the screen
 * (`translate(tx, ty) scale(s)`), so the stored geometry never changes when the
 * user zooms, pans or resizes the window.
 *
 * Editing handles live in a separate, untransformed overlay group so they stay
 * a constant size on screen at any zoom level.
 */

import { pointInPolygon } from './geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const HANDLE_RADIUS = 5;
export const HIT_RADIUS = 9;

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, String(value));
  }
  return node;
}

function pointsAttr(vertices) {
  return vertices.map((p) => `${p.x},${p.y}`).join(' ');
}

export class Renderer {
  constructor(svg) {
    this.svg = svg;
    this.defs = el('defs', { id: 'svg-defs' });
    this.viewport = el('g', { id: 'viewport' });
    this.bgLayer = el('g', { id: 'bg-layer' });
    this.polygonLayer = el('g', { id: 'polygon-layer' });
    this.outlineLayer = el('g', { id: 'outline-layer' });
    this.previewLayer = el('g', { id: 'preview-layer' });
    this.handleLayer = el('g', { id: 'handle-layer' });

    this.viewport.append(this.bgLayer, this.polygonLayer, this.outlineLayer, this.previewLayer);
    svg.replaceChildren(this.defs, this.viewport, this.handleLayer);

    this.bgImage = null;
    this.bgHref = null;
    this.subdivLayer = null;
    this.patternIds = new Map();
  }

  /* ---------------------------------------------------------------- */
  /* View                                                              */
  /* ---------------------------------------------------------------- */

  setView(view) {
    this.viewport.setAttribute(
      'transform',
      `translate(${view.tx} ${view.ty}) scale(${view.scale})`,
    );
  }

  imageToScreen(point, view) {
    return { x: point.x * view.scale + view.tx, y: point.y * view.scale + view.ty };
  }

  /* ---------------------------------------------------------------- */
  /* Background                                                        */
  /* ---------------------------------------------------------------- */

  setImage(image, settings) {
    const href = image ? image.dataUrl : null;
    if (!image) {
      this.bgLayer.replaceChildren();
      this.bgImage = null;
      this.bgHref = null;
      return;
    }

    if (this.bgHref !== href) {
      this.bgLayer.replaceChildren();
      this.bgImage = el('image', {
        id: 'background-image',
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
        preserveAspectRatio: 'none',
        href,
      });
      this.bgLayer.append(this.bgImage);
      this.bgHref = href;
    }

    this.bgLayer.setAttribute('visibility', settings.backgroundVisible ? 'visible' : 'hidden');
  }

  /* ---------------------------------------------------------------- */
  /* Texture patterns                                                  */
  /* ---------------------------------------------------------------- */

  /** Build (or reuse) an SVG pattern for a polygon texture; returns its id. */
  syncTexturePattern(polygon) {
    const texture = polygon.texture;
    if (!texture || !texture.href) return null;

    const scale = texture.scale || 1;
    const key = `${texture.href}|${scale}|${texture.offsetX || 0}|${texture.offsetY || 0}`;
    if (this.patternIds.has(key)) return this.patternIds.get(key);

    const id = `tex-${this.patternIds.size + 1}`;
    const width = Math.max(1, (texture.width || 64) * scale);
    const height = Math.max(1, (texture.height || 64) * scale);

    const pattern = el('pattern', {
      id,
      patternUnits: 'userSpaceOnUse',
      width,
      height,
      patternTransform: `translate(${texture.offsetX || 0} ${texture.offsetY || 0})`,
    });
    pattern.append(
      el('image', {
        href: texture.href,
        width,
        height,
        preserveAspectRatio: 'none',
      }),
    );
    this.defs.append(pattern);
    this.patternIds.set(key, id);
    return id;
  }

  clearTexturePatterns() {
    this.defs.replaceChildren();
    this.patternIds.clear();
  }

  /* ---------------------------------------------------------------- */
  /* Polygons                                                          */
  /* ---------------------------------------------------------------- */

  renderPolygons(polygons, settings, selection) {
    const selected = new Set(selection || []);
    const nodes = [];
    const usedPatterns = new Set();

    for (const polygon of polygons) {
      if (polygon.vertices.length < 2) continue;
      const visible = polygon.visible !== false;

      const fillOpacity = settings.xray
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              (polygon.opacity === undefined ? 1 : polygon.opacity) * settings.overlayOpacity,
            ),
          );

      let fill = polygon.fill || '#888888';
      if (polygon.texture && polygon.texture.href) {
        const patternId = this.syncTexturePattern(polygon);
        if (patternId) {
          fill = `url(#${patternId})`;
          usedPatterns.add(patternId);
        }
      }

      nodes.push(
        el('polygon', {
          'data-id': polygon.id,
          points: pointsAttr(polygon.vertices),
          fill,
          'fill-opacity': visible ? fillOpacity : 0,
          stroke: 'none',
        }),
      );
    }

    this.polygonLayer.replaceChildren(...nodes);
    this.renderOutlines(polygons, settings, selected);
  }

  renderOutlines(polygons, settings, selected) {
    if (!settings.showOutlines) {
      this.outlineLayer.replaceChildren();
      return;
    }

    const nodes = [];
    for (const polygon of polygons) {
      if (polygon.vertices.length < 2 || polygon.visible === false) continue;
      const isSelected = selected.has(polygon.id);
      const isHighlighted = isSelected && settings.highlightSelection;
      nodes.push(
        el('polygon', {
          'data-id': polygon.id,
          points: pointsAttr(polygon.vertices),
          fill: 'none',
          stroke: isHighlighted ? 'var(--accent, #4f9dff)' : settings.outlineColor,
          'stroke-width': isHighlighted ? settings.outlineWidth + 1.5 : settings.outlineWidth,
          'stroke-linejoin': 'round',
          'vector-effect': 'non-scaling-stroke',
          class: isHighlighted ? 'poly-outline selected' : 'poly-outline',
        }),
      );
    }
    this.outlineLayer.replaceChildren(...nodes);
  }

  /* ---------------------------------------------------------------- */
  /* Drawing preview                                                   */
  /* ---------------------------------------------------------------- */

  renderDrawing(drawing, cursor) {
    if (!drawing || drawing.vertices.length === 0) {
      this.previewLayer.replaceChildren();
      return;
    }

    const nodes = [];
    const verts = drawing.vertices;

    if (verts.length >= 2) {
      const preview = cursor ? [...verts, cursor] : verts.slice();
      if (preview.length >= 3) {
        nodes.push(
          el('polygon', {
            points: pointsAttr(preview),
            fill: 'var(--accent-soft, rgba(79,157,255,0.25))',
            stroke: 'none',
          }),
        );
      }
      nodes.push(
        el('polyline', {
          points: pointsAttr(preview),
          fill: 'none',
          stroke: 'var(--accent, #4f9dff)',
          'stroke-width': 1.5,
          'stroke-dasharray': '5 3',
          'vector-effect': 'non-scaling-stroke',
        }),
      );
    }

    if (cursor) {
      const last = verts[verts.length - 1];
      nodes.push(
        el('line', {
          x1: last.x,
          y1: last.y,
          x2: cursor.x,
          y2: cursor.y,
          stroke: 'var(--accent, #4f9dff)',
          'stroke-width': 1.25,
          'vector-effect': 'non-scaling-stroke',
        }),
      );
    }

    this.previewLayer.replaceChildren(...nodes);
  }

  /* ---------------------------------------------------------------- */
  /* Subdivision preview                                               */
  /* ---------------------------------------------------------------- */

  renderSubdivisionPreview(triangles) {
    if (this.subdivLayer) {
      this.subdivLayer.remove();
      this.subdivLayer = null;
    }
    if (!triangles || triangles.length === 0) return;

    const layer = el('g', { id: 'subdiv-layer' });
    layer.append(
      ...triangles.map((tri) =>
        el('polygon', {
          points: pointsAttr(tri),
          fill: 'var(--accent-soft, rgba(79,157,255,0.3))',
          stroke: 'var(--accent, #4f9dff)',
          'stroke-width': 1,
          'vector-effect': 'non-scaling-stroke',
        }),
      ),
    );
    this.viewport.insertBefore(layer, this.previewLayer);
    this.subdivLayer = layer;
  }

  /* ---------------------------------------------------------------- */
  /* Handles (screen space)                                            */
  /* ---------------------------------------------------------------- */

  renderHandles(polygons, settings, view, options = {}) {
    const {
      selection = [],
      selectedVertex = null,
      hoverVertex = null,
      hoverEdge = null,
      drawing = null,
    } = options;
    const selected = new Set(selection);
    const nodes = [];

    const toScreen = (p) => this.imageToScreen(p, view);

    if (settings.showVertices || selection.length) {
      for (const polygon of polygons) {
        const isSelected = selected.has(polygon.id);
        if (!isSelected && !settings.showVertices) continue;
        if (polygon.visible === false && !isSelected) continue;

        polygon.vertices.forEach((vertex, index) => {
          const screen = toScreen(vertex);
          const isVertexSelected =
            selectedVertex &&
            selectedVertex.polygonId === polygon.id &&
            selectedVertex.index === index;
          const isHovered =
            hoverVertex && hoverVertex.polygonId === polygon.id && hoverVertex.index === index;
          nodes.push(
            el('circle', {
              cx: screen.x,
              cy: screen.y,
              r: isVertexSelected ? HANDLE_RADIUS + 1.5 : isHovered ? HANDLE_RADIUS + 1 : HANDLE_RADIUS,
              class: [
                'vertex-handle',
                isSelected ? 'selected' : '',
                isVertexSelected ? 'active' : '',
                isHovered ? 'hovered' : '',
              ]
                .filter(Boolean)
                .join(' '),
              'data-polygon': polygon.id,
              'data-index': index,
            }),
          );
        });
      }
    }

    if (hoverEdge && hoverEdge.point) {
      const screen = toScreen(hoverEdge.point);
      nodes.push(
        el('circle', {
          cx: screen.x,
          cy: screen.y,
          r: HANDLE_RADIUS - 1,
          class: 'edge-handle',
        }),
      );
    }

    if (drawing && drawing.vertices.length) {
      drawing.vertices.forEach((vertex, index) => {
        const screen = toScreen(vertex);
        const isFirst = index === 0;
        nodes.push(
          el('circle', {
            cx: screen.x,
            cy: screen.y,
            r: isFirst ? HANDLE_RADIUS + 2 : HANDLE_RADIUS,
            class: isFirst ? 'vertex-handle drawing first' : 'vertex-handle drawing',
            'data-drawing-index': index,
          }),
        );
      });
    }

    this.handleLayer.replaceChildren(...nodes);
  }

  /** Topmost polygon containing `point` (image coordinates). */
  hitTestPolygons(polygons, point) {
    for (let i = polygons.length - 1; i >= 0; i--) {
      const polygon = polygons[i];
      if (polygon.visible === false) continue;
      if (pointInPolygon(point, polygon.vertices)) return polygon;
    }
    return null;
  }
}
