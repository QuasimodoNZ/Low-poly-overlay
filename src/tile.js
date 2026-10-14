/**
 * Image-sampled textures.
 *
 * A "tile" texture repeats a small block of pixels taken from the middle of the
 * polygon across the whole polygon. Because the block is tiny, large-scale
 * information (lighting gradients, folds, wrinkles) is left out while the fine
 * weave/fibre grain of the surface survives — which is exactly the effect a
 * low-poly simplification of a textured surface wants.
 *
 * The pure pixel work lives in `sampling.js` (`extractTile`); this module only
 * turns the block into a PNG data URL (for SVG patterns and project files) and
 * packages it as a `texture` object like the ones used elsewhere in the editor.
 */

import { extractTile } from './sampling.js';
import { polygonCentroid } from './geometry.js';

export const DEFAULT_TILE_SIZE = 5;
export const MIN_TILE_SIZE = 1;
export const MAX_TILE_SIZE = 256;

/** Render a tile (`{ data, width, height }`) to a PNG data URL. */
export function tileToDataUrl(tile) {
  const canvas = document.createElement('canvas');
  canvas.width = tile.width;
  canvas.height = tile.height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(tile.width, tile.height);
  imageData.data.set(tile.data);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Build a repeatable texture from the pixels under `vertices`.
 *
 * The tile is grabbed from the polygon centroid, and `anchor` records that
 * centroid so the repeated tile stays centred on the polygon at any texture
 * scale (see `textureOrigin` in model.js).
 */
export function createSampledTexture(imageData, vertices, tileWidth, tileHeight) {
  if (!imageData || !vertices || vertices.length < 3) return null;
  const center = polygonCentroid(vertices);
  const tile = extractTile(imageData, center.x, center.y, tileWidth, tileHeight);
  if (!tile) return null;

  return {
    mode: 'sample',
    href: tileToDataUrl(tile),
    width: tile.width,
    height: tile.height,
    tileWidth: tile.width,
    tileHeight: tile.height,
    sourceX: tile.sourceX,
    sourceY: tile.sourceY,
    anchor: { x: center.x, y: center.y },
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
}
