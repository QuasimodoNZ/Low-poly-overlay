import test from 'node:test';
import assert from 'node:assert/strict';

import { textureOrigin, cloneTexture, serializePolygons } from '../src/model.js';

test('textureOrigin uses explicit offsets for file textures', () => {
  const origin = textureOrigin({ width: 32, height: 32, scale: 2, offsetX: 4, offsetY: -6 });
  assert.deepEqual(origin, { x: 4, y: -6 });
});

test('textureOrigin centres an anchored tile on its anchor at any scale', () => {
  const texture = {
    mode: 'sample',
    width: 5,
    height: 5,
    scale: 1,
    anchor: { x: 100, y: 50 },
  };

  // Tile centre must land on the anchor: origin + size / 2 === anchor.
  const at1 = textureOrigin(texture, 1);
  assert.deepEqual(at1, { x: 97.5, y: 47.5 });
  assert.equal(at1.x + (5 * 1) / 2, 100);
  assert.equal(at1.y + (5 * 1) / 2, 50);

  const at4 = textureOrigin(texture, 4);
  assert.equal(at4.x + (5 * 4) / 2, 100);
  assert.equal(at4.y + (5 * 4) / 2, 50);
});

test('cloneTexture copies the anchor and never duplicates the decoded image', () => {
  const image = { tagName: 'IMG' };
  const texture = { mode: 'sample', href: 'data:image/png;base64,AA', width: 5, height: 5, anchor: { x: 1, y: 2 }, image };
  const clone = cloneTexture(texture);

  assert.notEqual(clone, texture);
  assert.notEqual(clone.anchor, texture.anchor);
  assert.deepEqual(clone.anchor, { x: 1, y: 2 });
  assert.equal(clone.image, image); // shared reference, not deep-copied
  assert.equal(cloneTexture(null), null);
});

test('serializePolygons drops the decoded image but keeps the texture data', () => {
  const polygons = [
    {
      id: 'p',
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
      fill: '#fff',
      opacity: 1,
      visible: true,
      name: '',
      texture: {
        mode: 'sample',
        href: 'data:image/png;base64,AA',
        width: 5,
        height: 5,
        tileWidth: 5,
        tileHeight: 5,
        anchor: { x: 10, y: 20 },
        scale: 1,
        image: { tagName: 'IMG' },
      },
      meta: {},
    },
  ];

  const serialized = serializePolygons(polygons);
  const texture = serialized[0].texture;
  assert.equal(texture.mode, 'sample');
  assert.deepEqual(texture.anchor, { x: 10, y: 20 });
  assert.equal(texture.image, undefined);
  // Must survive JSON, which is how projects are stored.
  const roundTripped = JSON.parse(JSON.stringify(serialized));
  assert.deepEqual(roundTripped[0].texture.anchor, { x: 10, y: 20 });
});
