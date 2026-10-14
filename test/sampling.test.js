import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hexToRgb,
  rgbToHex,
  rgbToLab,
  labToRgb,
  averageColorRGB,
  averageColorLab,
  getPixel,
  compositeOver,
  sampleComposite,
} from '../src/sampling.js';

function makeImageData(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { r, g, b, a } = fill(x, y);
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a === undefined ? 255 : a;
    }
  }
  return { data, width, height };
}

test('hexToRgb / rgbToHex round-trip', () => {
  assert.deepEqual(hexToRgb('#ff8800'), { r: 255, g: 136, b: 0 });
  assert.deepEqual(hexToRgb('f80'), { r: 255, g: 136, b: 0 });
  assert.equal(rgbToHex({ r: 255, g: 136, b: 0 }), '#ff8800');
  assert.equal(hexToRgb('nope'), null);
});

test('rgbToLab / labToRgb round-trip within tolerance', () => {
  for (const color of [
    { r: 255, g: 255, b: 255 },
    { r: 0, g: 0, b: 0 },
    { r: 200, g: 60, b: 30 },
    { r: 12, g: 180, b: 240 },
  ]) {
    const back = labToRgb(rgbToLab(color));
    assert.ok(Math.abs(back.r - color.r) <= 1, `r ${color.r} -> ${back.r}`);
    assert.ok(Math.abs(back.g - color.g) <= 1, `g ${color.g} -> ${back.g}`);
    assert.ok(Math.abs(back.b - color.b) <= 1, `b ${color.b} -> ${back.b}`);
  }
});

test('averageColorRGB averages only pixels inside the polygon', () => {
  const image = makeImageData(10, 10, (x) => (x < 5 ? { r: 255, g: 0, b: 0 } : { r: 0, g: 0, b: 255 }));
  const leftHalf = [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 5, y: 10 },
    { x: 0, y: 10 },
  ];
  const avg = averageColorRGB(image, leftHalf);
  assert.equal(avg.r, 255);
  assert.equal(avg.b, 0);
  assert.equal(avg.count, 50);
});

test('averageColorRGB excludes bounding-box corners for concave polygons', () => {
  // Uniform image: we only check the pixel count matches the L-shape area.
  const image = makeImageData(6, 6, () => ({ r: 100, g: 100, b: 100 }));
  const lShape = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 6 },
    { x: 0, y: 6 },
  ];
  const avg = averageColorRGB(image, lShape);
  assert.equal(avg.count, 20); // 6x2 + 2x4
  assert.equal(avg.r, 100);
});

test('averageColorRGB alpha-weights transparent pixels', () => {
  // Half fully transparent black, half opaque white.
  const image = makeImageData(4, 1, (x) =>
    x < 2 ? { r: 0, g: 0, b: 0, a: 0 } : { r: 255, g: 255, b: 255, a: 255 },
  );
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 1 },
    { x: 0, y: 1 },
  ];
  const avg = averageColorRGB(image, square);
  assert.equal(avg.r, 255);
  assert.equal(avg.a, 128); // mean alpha of 0 and 255
});

test('averageColorLab returns a plausible perceptual average', () => {
  const image = makeImageData(2, 1, () => ({ r: 10, g: 10, b: 10 }));
  const square = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 0, y: 1 },
  ];
  const avg = averageColorLab(image, square);
  assert.ok(Math.abs(avg.r - 10) <= 1);
  assert.ok(Math.abs(avg.g - 10) <= 1);
  assert.ok(Math.abs(avg.b - 10) <= 1);
});

test('averageColorRGB returns null when the polygon misses the image', () => {
  const image = makeImageData(4, 4, () => ({ r: 0, g: 0, b: 0 }));
  const far = [
    { x: 100, y: 100 },
    { x: 110, y: 100 },
    { x: 110, y: 110 },
  ];
  assert.equal(averageColorRGB(image, far), null);
});

test('getPixel clamps to image bounds', () => {
  const image = makeImageData(2, 2, (x, y) => ({ r: x * 10, g: y * 10, b: 0 }));
  assert.deepEqual(getPixel(image, 0, 0), { r: 0, g: 0, b: 0, a: 255 });
  assert.deepEqual(getPixel(image, 1, 1), { r: 10, g: 10, b: 0, a: 255 });
  assert.deepEqual(getPixel(image, 99, 99), { r: 10, g: 10, b: 0, a: 255 });
});

test('compositeOver blends source over destination', () => {
  const over = compositeOver({ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }, 0.5);
  assert.equal(over.r, 128); // 127.5 rounds up
  assert.equal(over.g, 128);
  assert.equal(over.a, 255);
});

test('sampleComposite respects stacking order and opacity', () => {
  const background = { r: 255, g: 255, b: 255, a: 255 };
  const bottom = {
    id: 'a',
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    fill: '#ff0000',
    opacity: 1,
    visible: true,
  };
  const top = {
    id: 'b',
    vertices: [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ],
    fill: '#0000ff',
    opacity: 0.5,
    visible: true,
  };

  // Over the fully opaque red polygon only.
  const red = sampleComposite({ x: 8, y: 8 }, [bottom, top], background);
  assert.deepEqual({ r: red.r, g: red.g, b: red.b }, { r: 255, g: 0, b: 0 });

  // Over the semi-transparent blue polygon, blended over red.
  const mixed = sampleComposite({ x: 2, y: 2 }, [bottom, top], background);
  assert.ok(Math.abs(mixed.r - 127) <= 2);
  assert.ok(Math.abs(mixed.b - 127) <= 2);

  // Reversing the order changes the result (stacking matters).
  const reversed = sampleComposite({ x: 2, y: 2 }, [top, bottom], background);
  assert.deepEqual({ r: reversed.r, g: reversed.g, b: reversed.b }, { r: 255, g: 0, b: 0 });

  // Outside both polygons -> the background.
  const bg = sampleComposite({ x: 50, y: 50 }, [bottom, top], background);
  assert.deepEqual({ r: bg.r, g: bg.g, b: bg.b }, { r: 255, g: 255, b: 255 });
});
