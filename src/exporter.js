/**
 * Export utilities.
 *
 * `polygonsToSVGString` is pure (returns a string) and unit-testable.
 * The canvas helpers need a browser, but they are thin wrappers: they receive
 * already-decoded images / image data and only orchestrate drawing.
 */

import { hexToRgb } from './sampling.js';
import { polygonBounds } from './geometry.js';
import { textureOrigin } from './model.js';

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPoints(vertices) {
  return vertices.map((p) => `${round2(p.x)},${round2(p.y)}`).join(' ');
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function opacityValue(polygon, overlayOpacity) {
  const o = (polygon.opacity === undefined ? 1 : polygon.opacity) * overlayOpacity;
  return round2(Math.max(0, Math.min(1, o)));
}

/**
 * Build a standalone SVG document for the polygon artwork.
 *
 * @param {Array} polygons       polygons in image coordinates
 * @param {Object} options
 * @param {number} options.width  output width (defaults to image width)
 * @param {number} options.height output height
 * @param {string} [options.backgroundHref] data URL to embed as <image>
 * @param {number} [options.overlayOpacity]
 * @param {boolean} [options.includeBackground]
 * @param {boolean} [options.includePolygons]
 */
export function polygonsToSVGString(polygons, options = {}) {
  const width = options.width || 100;
  const height = options.height || 100;
  const overlayOpacity = options.overlayOpacity === undefined ? 1 : options.overlayOpacity;
  const includeBackground = !!options.includeBackground && !!options.backgroundHref;
  const includePolygons = options.includePolygons !== false;

  const defs = [];
  const body = [];

  if (includeBackground) {
    body.push(
      `  <image href="${escapeAttr(options.backgroundHref)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>`,
    );
  }

  if (includePolygons) {
    const groups = [];
    const texturePatterns = new Map();
    let patternId = 0;

    for (const polygon of polygons) {
      if (polygon.visible === false) continue;
      if (!polygon.vertices || polygon.vertices.length < 3) continue;

      let fill = polygon.fill || '#000000';
      let fillOpacity = opacityValue(polygon, overlayOpacity);

      if (polygon.texture && polygon.texture.href) {
        const s = polygon.texture.scale || 1;
        const origin = textureOrigin(polygon.texture, s);
        const texW = Math.max(1, (polygon.texture.width || 64) * s);
        const texH = Math.max(1, (polygon.texture.height || 64) * s);
        const key = `${polygon.texture.href}|${round2(texW)}|${round2(texH)}|${round2(origin.x)}|${round2(origin.y)}`;
        if (!texturePatterns.has(key)) {
          patternId += 1;
          const id = `tex${patternId}`;
          texturePatterns.set(key, id);
          defs.push(
            `    <pattern id="${id}" patternUnits="userSpaceOnUse" width="${round2(texW)}" height="${round2(texH)}" ` +
              `patternTransform="translate(${round2(origin.x)} ${round2(origin.y)})">` +
              `<image href="${escapeAttr(polygon.texture.href)}" width="${round2(texW)}" height="${round2(texH)}" preserveAspectRatio="none"/>` +
              `</pattern>`,
          );
        }
        fill = `url(#${texturePatterns.get(key)})`;
      }

      groups.push(
        `    <polygon points="${formatPoints(polygon.vertices)}" fill="${escapeAttr(fill)}" fill-opacity="${fillOpacity}" stroke="none"/>`,
      );
    }

    body.push(`  <g id="polygons">`, ...groups, `  </g>`);
  }

  const defsBlock = defs.length ? `  <defs>\n${defs.join('\n')}\n  </defs>\n` : '';

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
    defsBlock +
    body.join('\n') +
    `\n</svg>\n`
  );
}

/**
 * Draw polygons onto a 2D canvas context.
 * Used for both the composite and transparent PNG exports.
 */
export function drawPolygonsToContext(ctx, polygons, options = {}) {
  const overlayOpacity = options.overlayOpacity === undefined ? 1 : options.overlayOpacity;
  const skipFills = !!options.skipFills;

  for (const polygon of polygons) {
    if (polygon.visible === false) continue;
    if (!polygon.vertices || polygon.vertices.length < 3) continue;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(polygon.vertices[0].x, polygon.vertices[0].y);
    for (let i = 1; i < polygon.vertices.length; i++) {
      ctx.lineTo(polygon.vertices[i].x, polygon.vertices[i].y);
    }
    ctx.closePath();

    if (!skipFills) {
      ctx.globalAlpha = Math.max(0, Math.min(1, opacityValue(polygon, overlayOpacity)));
      if (polygon.texture && polygon.texture.image) {
        const pattern = ctx.createPattern(polygon.texture.image, 'repeat');
        if (pattern) {
          const s = polygon.texture.scale || 1;
          const origin = textureOrigin(polygon.texture, s);
          const m = new DOMMatrix();
          m.a = s;
          m.d = s;
          m.e = origin.x;
          m.f = origin.y;
          pattern.setTransform(m);
          ctx.fillStyle = pattern;
        } else {
          ctx.fillStyle = polygon.fill || '#000000';
        }
      } else {
        ctx.fillStyle = polygon.fill || '#000000';
      }
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Create an offscreen canvas of the given size and return [canvas, ctx]. */
export function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  return { canvas, ctx };
}

/** Render the full composition (background + polygons) to a canvas. */
export function renderCompositeCanvas(image, polygons, options = {}) {
  const width = options.width || (image ? image.naturalWidth : 100);
  const height = options.height || (image ? image.naturalHeight : 100);
  const { canvas, ctx } = createCanvas(width, height);
  ctx.clearRect(0, 0, width, height);

  if (options.includeBackground !== false && image) {
    ctx.drawImage(image, 0, 0, width, height);
  }

  if (options.includePolygons !== false) {
    drawPolygonsToContext(ctx, polygons, {
      overlayOpacity: options.overlayOpacity,
    });
  }

  return canvas;
}

/** Trigger a browser download for a blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text, filename, mime = 'image/svg+xml') {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export function canvasToBlob(canvas, mime = 'image/png') {
  return new Promise((resolve) => canvas.toBlob(resolve, mime));
}

/** Suggest a filename stem from an imported image name. */
export function exportStem(imageName) {
  const stem = (imageName || 'artwork').replace(/\.[^.]+$/, '');
  return stem.replace(/[^\w.-]+/g, '_') || 'artwork';
}

/** Simple bounding-box helper reused by the export UI for resolution presets. */
export function artworkBounds(polygons) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of polygons) {
    const b = polygonBounds(polygon.vertices);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

export { hexToRgb };
