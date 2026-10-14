/**
 * Colour sampling utilities.
 *
 * Pure functions only (no canvas / DOM access). Callers extract pixel data with
 * `ctx.getImageData(...)` and pass it in as `{ data, width, height }`, which is
 * exactly the shape of a browser `ImageData`, so this module is also testable
 * in Node.
 */

import { pointInPolygon, polygonBounds } from './geometry.js';

/* ------------------------------------------------------------------ */
/* Colour conversions                                                 */
/* ------------------------------------------------------------------ */

export function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function rgbToHex({ r, g, b }) {
  const toHex = (v) => clampByte(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToRgb(hex) {
  let value = String(hex).trim().replace(/^#/, '');
  if (value.length === 3) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function isValidHex(hex) {
  return hexToRgb(hex) !== null;
}

function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(channel) {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
  return clampByte(c * 255);
}

/** Convert sRGB (0-255) to CIELAB (D65). */
export function rgbToLab({ r, g, b }) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);

  // sRGB -> XYZ (D65)
  const x = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750;
  const z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041;

  // Normalise by D65 white point.
  const xn = 0.95047;
  const yn = 1.0;
  const zn = 1.08883;

  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / xn);
  const fy = f(y / yn);
  const fz = f(z / zn);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** Convert CIELAB (D65) back to sRGB (0-255). */
export function labToRgb({ L, a, b }) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const finv = (t) => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
  };

  const xn = 0.95047;
  const yn = 1.0;
  const zn = 1.08883;

  const x = finv(fx) * xn;
  const y = finv(fy) * yn;
  const z = finv(fz) * zn;

  // XYZ -> linear sRGB
  const R = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const G = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
  const B = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

  return {
    r: linearToSrgb(R),
    g: linearToSrgb(G),
    b: linearToSrgb(B),
  };
}

/* ------------------------------------------------------------------ */
/* Image sampling                                                     */
/* ------------------------------------------------------------------ */

/**
 * Mean colour of the pixels whose centre falls inside `polygon`.
 *
 * Pixels are alpha-weighted so transparent source pixels do not darken the
 * result. Returns `null` when no pixel of the polygon lands on the image.
 */
export function averageColorRGB(imageData, polygon) {
  const { data, width, height } = imageData;
  if (!data || width <= 0 || height <= 0 || polygon.length < 3) return null;

  const bounds = polygonBounds(polygon);
  const minX = Math.max(0, Math.floor(bounds.minX));
  const minY = Math.max(0, Math.floor(bounds.minY));
  const maxX = Math.min(width - 1, Math.ceil(bounds.maxX));
  const maxY = Math.min(height - 1, Math.ceil(bounds.maxY));

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumA = 0;
  let count = 0;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!pointInPolygon({ x: x + 0.5, y: y + 0.5 }, polygon)) continue;
      const idx = (y * width + x) * 4;
      const a = data[idx + 3];
      const weight = a / 255;
      sumR += data[idx] * weight;
      sumG += data[idx + 1] * weight;
      sumB += data[idx + 2] * weight;
      sumA += a;
      count++;
    }
  }

  if (count === 0) return null;

  return {
    r: sumA > 0 ? clampByte(sumR / (sumA / 255)) : 0,
    g: sumA > 0 ? clampByte(sumG / (sumA / 255)) : 0,
    b: sumA > 0 ? clampByte(sumB / (sumA / 255)) : 0,
    a: clampByte(sumA / count),
    count,
  };
}

/**
 * Perceptual mean colour: average in CIELAB then convert back to sRGB. This
 * avoids the muddy result a plain RGB average can give.
 */
export function averageColorLab(imageData, polygon) {
  const { data, width, height } = imageData;
  if (!data || width <= 0 || height <= 0 || polygon.length < 3) return null;

  const bounds = polygonBounds(polygon);
  const minX = Math.max(0, Math.floor(bounds.minX));
  const minY = Math.max(0, Math.floor(bounds.minY));
  const maxX = Math.min(width - 1, Math.ceil(bounds.maxX));
  const maxY = Math.min(height - 1, Math.ceil(bounds.maxY));

  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  let alphaSum = 0;
  let count = 0;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!pointInPolygon({ x: x + 0.5, y: y + 0.5 }, polygon)) continue;
      const idx = (y * width + x) * 4;
      const a = data[idx + 3];
      if (a === 0) continue; // fully transparent pixels carry no colour
      const lab = rgbToLab({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
      sumL += lab.L;
      sumA += lab.a;
      sumB += lab.b;
      alphaSum += a;
      count++;
    }
  }

  if (count === 0) return null;

  const rgb = labToRgb({ L: sumL / count, a: sumA / count, b: sumB / count });
  return { ...rgb, a: clampByte(alphaSum / count), count };
}

/** Clamp a point to the nearest valid pixel coordinate. */
export function getPixel(imageData, x, y) {
  const { data, width, height } = imageData;
  if (!data || width <= 0 || height <= 0) return null;
  const px = Math.min(width - 1, Math.max(0, Math.floor(x)));
  const py = Math.min(height - 1, Math.max(0, Math.floor(y)));
  const idx = (py * width + px) * 4;
  return { r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3] };
}

/* ------------------------------------------------------------------ */
/* Tile sampling (used by the image-sampled texture mode)             */
/* ------------------------------------------------------------------ */

function clampIndex(value, size) {
  return Math.min(size - 1, Math.max(0, value));
}

/**
 * Copy a `tileWidth × tileHeight` pixel block out of an image, centred on
 * `(centerX, centerY)`.
 *
 * Sampling outside the image clamps to the nearest edge pixel, so the tile
 * always has exactly the requested size and never contains undefined pixels.
 * The result is `{ data, width, height, sourceX, sourceY }` where `data` is an
 * RGBA `Uint8ClampedArray` laid out like a canvas `ImageData`.
 */
export function extractTile(imageData, centerX, centerY, tileWidth, tileHeight) {
  const { data, width, height } = imageData || {};
  if (!data || width <= 0 || height <= 0) return null;

  const tw = Math.max(1, Math.round(Number(tileWidth) || 1));
  const th = Math.max(1, Math.round(Number(tileHeight) || 1));

  // Top-left of the sampled block. `- tw / 2` keeps the block centred on the
  // requested point (which is the polygon centroid for a sampled texture).
  const sourceX = Math.round(centerX - tw / 2);
  const sourceY = Math.round(centerY - th / 2);
  const out = new Uint8ClampedArray(tw * th * 4);

  for (let y = 0; y < th; y++) {
    const sy = clampIndex(sourceY + y, height);
    for (let x = 0; x < tw; x++) {
      const sx = clampIndex(sourceX + x, width);
      const src = (sy * width + sx) * 4;
      const dst = (y * tw + x) * 4;
      out[dst] = data[src];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src + 2];
      out[dst + 3] = data[src + 3];
    }
  }

  return { data: out, width: tw, height: th, sourceX, sourceY };
}

/* ------------------------------------------------------------------ */
/* Composite sampling                                                 */
/* ------------------------------------------------------------------ */

/** Composite a source colour (with 0-255 alpha) over a destination colour. */
export function compositeOver(dst, src, srcAlpha) {
  const sa = Math.max(0, Math.min(1, srcAlpha)) * (src.a !== undefined ? src.a / 255 : 1);
  const da = dst.a !== undefined ? dst.a / 255 : 1;
  if (sa <= 0) return { ...dst };
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (s, d) => (s * sa + d * da * (1 - sa)) / outA;
  return {
    r: clampByte(mix(src.r, dst.r)),
    g: clampByte(mix(src.g, dst.g)),
    b: clampByte(mix(src.b, dst.b)),
    a: clampByte(outA * 255),
  };
}

/**
 * Colour actually visible at `point`, given the background pixel and the
 * polygon stack (bottom to top). Respects fill colour, per-polygon opacity,
 * the global overlay opacity and stacking order.
 *
 * `background` may be null (no image / hidden image), in which case it is
 * treated as fully transparent.
 */
export function sampleComposite(point, polygons, background, overlayOpacity = 1) {
  let result = background
    ? { r: background.r, g: background.g, b: background.b, a: background.a }
    : { r: 0, g: 0, b: 0, a: 0 };

  for (const polygon of polygons) {
    if (polygon.visible === false) continue;
    if (!pointInPolygon(point, polygon.vertices)) continue;
    const alpha = (polygon.opacity === undefined ? 1 : polygon.opacity) * overlayOpacity;
    const fill = hexToRgb(polygon.fill) || { r: 0, g: 0, b: 0 };
    result = compositeOver(result, { ...fill, a: 255 }, alpha);
  }

  return result;
}
