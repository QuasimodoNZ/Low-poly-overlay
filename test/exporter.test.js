import test from 'node:test';
import assert from 'node:assert/strict';

import { polygonsToSVGString, exportStem, artworkBounds } from '../src/exporter.js';

const polygons = [
  {
    id: 'a',
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ],
    fill: '#ff0000',
    opacity: 0.5,
    visible: true,
  },
  {
    id: 'b',
    vertices: [
      { x: 20, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 30 },
      { x: 20, y: 30 },
    ],
    fill: '#00ff00',
    opacity: 1,
    visible: false,
  },
];

test('SVG output is well-formed and carries dimensions + viewBox', () => {
  const svg = polygonsToSVGString(polygons, { width: 100, height: 50 });
  assert.match(svg, /^<\?xml version="1\.0"/);
  assert.match(svg, /<svg [^>]*width="100"/);
  assert.match(svg, /<svg [^>]*height="50"/);
  assert.match(svg, /viewBox="0 0 100 50"/);
  assert.match(svg, /<\/svg>\s*$/);
});

test('SVG emits polygon geometry with fill and opacity', () => {
  const svg = polygonsToSVGString(polygons, { width: 100, height: 50 });
  assert.match(svg, /points="0,0 10,0 5,10"/);
  assert.match(svg, /fill="#ff0000"/);
  assert.match(svg, /fill-opacity="0\.5"/);
});

test('hidden polygons are excluded from the SVG', () => {
  const svg = polygonsToSVGString(polygons, { width: 100, height: 50 });
  assert.doesNotMatch(svg, /#00ff00/);
  assert.doesNotMatch(svg, /points="20,20/);
});

test('embedded background image is optional', () => {
  const without = polygonsToSVGString(polygons, { width: 100, height: 50 });
  assert.doesNotMatch(without, /<image /);

  const withImage = polygonsToSVGString(polygons, {
    width: 100,
    height: 50,
    backgroundHref: 'data:image/png;base64,AAAA',
    includeBackground: true,
  });
  assert.match(withImage, /<image href="data:image\/png;base64,AAAA"/);
});

test('overlay opacity multiplies polygon opacity', () => {
  const svg = polygonsToSVGString(polygons, { width: 100, height: 50, overlayOpacity: 0.5 });
  assert.match(svg, /fill-opacity="0\.25"/);
});

test('an image-sampled texture exports as a repeatable SVG pattern', () => {
  const textured = [
    {
      id: 't',
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      fill: '#123456',
      opacity: 1,
      visible: true,
      texture: {
        mode: 'sample',
        href: 'data:image/png;base64,AAAA',
        width: 5,
        height: 5,
        anchor: { x: 50, y: 50 },
        scale: 1,
      },
    },
  ];

  const svg = polygonsToSVGString(textured, { width: 100, height: 100 });
  assert.match(svg, /<pattern id="tex1" patternUnits="userSpaceOnUse" width="5" height="5"/);
  // Origin = anchor - tile / 2.
  assert.match(svg, /patternTransform="translate\(47\.5 47\.5\)"/);
  assert.match(svg, /<image href="data:image\/png;base64,AAAA" width="5" height="5"/);
  assert.match(svg, /fill="url\(#tex1\)"/);
  assert.doesNotMatch(svg, /fill="#123456"/);
});

test('scaled textures scale the tile and keep the anchor centred', () => {
  const textured = [
    {
      id: 't',
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      fill: '#123456',
      opacity: 1,
      visible: true,
      texture: { mode: 'sample', href: 'data:image/png;base64,AAAA', width: 5, height: 5, anchor: { x: 50, y: 50 }, scale: 4 },
    },
  ];

  const svg = polygonsToSVGString(textured, { width: 100, height: 100 });
  assert.match(svg, /width="20" height="20"/);
  assert.match(svg, /patternTransform="translate\(40 40\)"/);
});

test('identical textures share one pattern definition', () => {
  const texture = { mode: 'sample', href: 'data:image/png;base64,AAAA', width: 5, height: 5, anchor: { x: 10, y: 10 }, scale: 1 };
  const make = (id, x) => ({
    id,
    vertices: [
      { x, y: 0 },
      { x: x + 10, y: 0 },
      { x: x + 10, y: 10 },
    ],
    fill: '#000000',
    opacity: 1,
    visible: true,
    texture: { ...texture },
  });

  const svg = polygonsToSVGString([make('a', 0), make('b', 40)], { width: 100, height: 100 });
  assert.equal((svg.match(/<pattern /g) || []).length, 1);
  assert.equal((svg.match(/url\(#tex1\)/g) || []).length, 2);
});

test('exportStem strips extensions and unsafe characters', () => {
  assert.equal(exportStem('my photo.png'), 'my_photo');
  assert.equal(exportStem(''), 'artwork');
});

test('artworkBounds spans all polygons', () => {
  const bounds = artworkBounds(polygons);
  assert.deepEqual(bounds, { minX: 0, minY: 0, maxX: 30, maxY: 30 });
  assert.equal(artworkBounds([]), null);
});
