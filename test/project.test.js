import test from 'node:test';
import assert from 'node:assert/strict';

import { serializeProject, projectToJSON, parseProject } from '../src/project.js';

const polygons = [
  {
    id: 'p1',
    vertices: [
      { x: 0.1234, y: 1.9876 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ],
    fill: '#336699',
    opacity: 0.7,
    visible: true,
    name: 'face',
    texture: null,
    meta: {},
  },
];

test('project round-trips through JSON', () => {
  const project = serializeProject({
    image: { name: 'photo.png', width: 100, height: 50, dataUrl: 'data:image/png;base64,AAAA' },
    polygons,
    settings: { xray: true, outlineColor: '#123456' },
  });

  const json = projectToJSON(project);
  const parsed = parseProject(json);

  assert.equal(parsed.image.dataUrl, 'data:image/png;base64,AAAA');
  assert.equal(parsed.image.name, 'photo.png');
  assert.equal(parsed.polygons.length, 1);
  assert.equal(parsed.polygons[0].fill, '#336699');
  assert.equal(parsed.polygons[0].opacity, 0.7);
  assert.equal(parsed.polygons[0].vertices[0].x, 0.123);
  assert.equal(parsed.settings.xray, true);
  assert.equal(parsed.settings.outlineColor, '#123456');
  // Missing settings fall back to defaults.
  assert.equal(parsed.settings.backgroundVisible, true);
});

test('parseProject rejects foreign files', () => {
  assert.throws(() => parseProject('{"format":"something-else"}'), /Not a Low-Poly/);
  assert.throws(() => parseProject('not json'), /valid JSON/);
});

test('parseProject drops degenerate polygons and tolerates a missing image', () => {
  const parsed = parseProject({
    format: 'low-poly-overlay-project',
    version: 1,
    image: null,
    polygons: [
      { vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
    ],
    settings: {},
  });
  assert.equal(parsed.polygons.length, 1);
  assert.equal(parsed.image, null);
});
