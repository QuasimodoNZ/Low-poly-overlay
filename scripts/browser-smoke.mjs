/**
 * End-to-end browser smoke test.
 *
 * Boots the static app on a temporary local HTTP server and drives the real UI
 * with a headless Chromium: import an image, draw/edit polygons, sample
 * colours, use the eyedropper, toggle X-ray and run every export.
 *
 * Run with:  node scripts/browser-smoke.mjs
 * Requires Playwright (installed with `npm i --no-save playwright && npx playwright install chromium`).
 */

import http from 'node:http';
import { readFile, mkdtemp, readFile as readFileAsync } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    const relative = normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(root, relative);
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const type = MIME[extname(filePath)] || 'application/octet-stream';
    createReadStream(filePath)
      .on('error', () => res.writeHead(404).end('not found'))
      .on('open', () => {
        res.writeHead(200, { 'Content-Type': type });
      })
      .pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  const { chromium } = await import('playwright');

  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  // Imports ask for confirmation when artwork already exists; accept so the
  // scripted flow never stalls on a native dialog.
  page.on('dialog', (dialog) => dialog.accept());

  const results = [];
  const check = (label, condition, detail = '') => {
    assert.ok(condition, `${label}${detail ? ` — ${detail}` : ''}`);
    results.push(`✔ ${label}`);
  };

  const downloadDir = await mkdtemp(join(tmpdir(), 'lpo-'));
  const grabDownload = async (selector) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
    const target = join(downloadDir, download.suggestedFilename());
    await download.saveAs(target);
    return target;
  };

  const stagePointFromImage = (ix, iy) =>
    page.evaluate(
      ([x, y]) => {
        const { state } = window.__lpo;
        const rect = document.getElementById('stage').getBoundingClientRect();
        return {
          x: rect.left + x * state.view.scale + state.view.tx,
          y: rect.top + y * state.view.scale + state.view.ty,
        };
      },
      [ix, iy],
    );

  await page.goto(base, { waitUntil: 'networkidle' });
  check('app boots with no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('export hook exposed', await page.evaluate(() => typeof window.__lpo === 'object'));

  // ---- Import an image (generated in-browser: red left half, blue right half)
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 32, 64);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(32, 0, 32, 64);
    return canvas.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
  await page.setInputFiles('#file-input', { name: 'test-image.png', mimeType: 'image/png', buffer });
  await page.waitForFunction(() => window.__lpo.state.image !== null);
  check('image imported', await page.evaluate(() => window.__lpo.state.image.width === 64));
  check(
    'image label shows dimensions',
    (await page.textContent('#image-label')).includes('64×64'),
  );

  const box = await page.locator('#stage').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // ---- Draw a triangle
  await page.click('#tool-draw');
  await page.mouse.click(cx - 120, cy - 90);
  await page.mouse.click(cx + 120, cy - 90);
  await page.mouse.click(cx, cy + 100);
  const drawingBeforeClose = await page.evaluate(() => window.__lpo.state.drawing?.vertices.length ?? 0);
  check('drawing preview tracks vertices', drawingBeforeClose === 3);
  await page.keyboard.press('Enter');
  const afterDraw = await page.evaluate(() => ({
    count: window.__lpo.state.polygons.length,
    verts: window.__lpo.state.polygons[0].vertices.length,
    fill: window.__lpo.state.polygons[0].fill,
  }));
  check('polygon created on Enter', afterDraw.count === 1 && afterDraw.verts === 3);
  check('new polygon auto-coloured from image', /^#[0-9a-f]{6}$/.test(afterDraw.fill), afterDraw.fill);

  // ---- Second polygon via double-click close / click first vertex
  await page.mouse.click(cx - 260, cy + 40);
  await page.mouse.click(cx - 180, cy + 40);
  await page.mouse.click(cx - 220, cy + 130);
  await page.mouse.click(cx - 260, cy + 40); // click the first vertex to close
  const count2 = await page.evaluate(() => window.__lpo.state.polygons.length);
  check('polygon closed by clicking the first vertex', count2 === 2);

  // ---- A polygon can also be closed with a double-click
  await page.mouse.click(cx + 60, cy + 60);
  await page.mouse.click(cx + 150, cy + 60);
  await page.mouse.dblclick(cx + 105, cy + 150);
  const countAfterDbl = await page.evaluate(() => window.__lpo.state.polygons.length);
  check('polygon closed by double-click', countAfterDbl === count2 + 1, `${count2} -> ${countAfterDbl}`);
  await page.keyboard.press('Control+z');
  check(
    'undo removes the double-clicked polygon',
    (await page.evaluate(() => window.__lpo.state.polygons.length)) === count2,
  );

  // ---- Concave polygon via vertex editing
  await page.click('#tool-select');
  const vertexPt = await page.evaluate(() => {
    const { state } = window.__lpo;
    const v = state.polygons[0].vertices[0];
    const rect = document.getElementById('stage').getBoundingClientRect();
    return {
      x: rect.left + v.x * state.view.scale + state.view.tx,
      y: rect.top + v.y * state.view.scale + state.view.ty,
      before: { ...v },
    };
  });
  await page.mouse.move(vertexPt.x, vertexPt.y);
  await page.mouse.down();
  await page.mouse.move(vertexPt.x + 40, vertexPt.y + 30, { steps: 5 });
  await page.mouse.up();
  const moved = await page.evaluate(() => ({ ...window.__lpo.state.polygons[0].vertices[0] }));
  check(
    'dragging a vertex reshapes the polygon',
    Math.abs(moved.x - vertexPt.before.x) > 1 || Math.abs(moved.y - vertexPt.before.y) > 1,
  );

  // ---- Undo restores the vertex
  await page.keyboard.press('Control+z');
  const restored = await page.evaluate(() => ({ ...window.__lpo.state.polygons[0].vertices[0] }));
  check(
    'undo restores the vertex position',
    Math.abs(restored.x - vertexPt.before.x) < 0.001 && Math.abs(restored.y - vertexPt.before.y) < 0.001,
  );
  await page.keyboard.press('Control+Shift+z');
  const redone = await page.evaluate(() => ({ ...window.__lpo.state.polygons[0].vertices[0] }));
  check('redo re-applies the edit', Math.abs(redone.x - moved.x) < 0.001);

  // ---- Escape cancels an unfinished polygon without adding one
  const countBeforeEscape = await page.evaluate(() => window.__lpo.state.polygons.length);
  await page.click('#tool-draw');
  await page.mouse.click(cx - 60, cy + 60);
  await page.mouse.click(cx - 10, cy + 60);
  await page.keyboard.press('Escape');
  const escaped = await page.evaluate(() => ({
    drawing: window.__lpo.state.drawing,
    count: window.__lpo.state.polygons.length,
  }));
  check('Escape cancels an unfinished polygon', escaped.drawing === null && escaped.count === countBeforeEscape);

  // ---- Drag the interior to move a whole polygon
  await page.click('#tool-select');
  const interior = await page.evaluate(() => {
    const { state } = window.__lpo;
    const polygon = state.polygons[1];
    const c = polygon.vertices.reduce((acc, v) => ({ x: acc.x + v.x / polygon.vertices.length, y: acc.y + v.y / polygon.vertices.length }), { x: 0, y: 0 });
    state.selection = [polygon.id];
    window.__lpo.render();
    window.__lpo.renderPanel();
    const rect = document.getElementById('stage').getBoundingClientRect();
    return {
      x: rect.left + c.x * state.view.scale + state.view.tx,
      y: rect.top + c.y * state.view.scale + state.view.ty,
      before: JSON.stringify(polygon.vertices),
    };
  });
  await page.mouse.move(interior.x, interior.y);
  await page.mouse.down();
  await page.mouse.move(interior.x + 55, interior.y + 35, { steps: 6 });
  await page.mouse.up();
  const movedPolygon = await page.evaluate(() => JSON.stringify(window.__lpo.state.polygons[1].vertices));
  check('dragging the interior moves the whole polygon', movedPolygon !== interior.before);
  await page.keyboard.press('Control+z');
  check(
    'undo restores a moved polygon',
    (await page.evaluate(() => JSON.stringify(window.__lpo.state.polygons[1].vertices))) === interior.before,
  );

  // ---- Double-click an edge to insert a vertex
  const edgePoint = await page.evaluate(() => {
    const { state } = window.__lpo;
    const polygon = state.polygons[0];
    state.selection = [polygon.id];
    window.__lpo.render();
    window.__lpo.renderPanel();
    const a = polygon.vertices[0];
    const b = polygon.vertices[1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const rect = document.getElementById('stage').getBoundingClientRect();
    return {
      x: rect.left + mid.x * state.view.scale + state.view.tx,
      y: rect.top + mid.y * state.view.scale + state.view.ty,
      count: polygon.vertices.length,
    };
  });
  await page.mouse.dblclick(edgePoint.x, edgePoint.y);
  const insertedCount = await page.evaluate(() => window.__lpo.state.polygons[0].vertices.length);
  check('double-clicking an edge inserts a vertex', insertedCount === edgePoint.count + 1, `${edgePoint.count} -> ${insertedCount}`);

  // ---- Delete a single vertex
  await page.evaluate(() => {
    const polygon = window.__lpo.state.polygons[0];
    window.__lpo.state.selection = [polygon.id];
    window.__lpo.state.selectedVertex = { polygonId: polygon.id, index: 0 };
    window.__lpo.render();
    window.__lpo.renderPanel();
  });
  await page.keyboard.press('Delete');
  const deletedVertexCount = await page.evaluate(() => window.__lpo.state.polygons[0].vertices.length);
  check('Delete removes the selected vertex without deleting the polygon', deletedVertexCount === insertedCount - 1);

  // The mandatory >= 3 vertex rule is enforced.
  await page.evaluate(() => {
    const polygon = window.__lpo.state.polygons[0];
    window.__lpo.state.selection = [polygon.id];
    window.__lpo.state.selectedVertex = { polygonId: polygon.id, index: 0 };
  });
  await page.keyboard.press('Delete');
  const guardedCount = await page.evaluate(() => window.__lpo.state.polygons[0].vertices.length);
  check('a polygon can never drop below 3 vertices', guardedCount === 3 && deletedVertexCount === 3);

  // ---- Coordinate invariance under zoom / fit / resize
  const geomBefore = await page.evaluate(() => JSON.stringify(window.__lpo.state.polygons));
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -400);
  await page.evaluate(() => window.__lpo.fitView());
  await page.mouse.wheel(0, 250);
  await page.setViewportSize({ width: 1100, height: 700 });
  const geomAfter = await page.evaluate(() => JSON.stringify(window.__lpo.state.polygons));
  check('geometry is invariant to zoom, fit and resize', geomBefore === geomAfter);
  const zoomText = await page.textContent('#zoom-label');
  check('zoom level displayed', /%$/.test(zoomText.trim()), zoomText);

  // ---- Average colour sampling (RGB)
  await page.evaluate(() => {
    // Make sure exactly the first polygon is selected and refit for stable clicks.
    window.__lpo.state.selection = [window.__lpo.state.polygons[0].id];
    window.__lpo.fitView();
    window.__lpo.render();
    window.__lpo.renderPanel();
  });
  const beforeAvg = await page.evaluate(() => window.__lpo.state.polygons[0].fill);
  await page.click('#btn-avg-rgb');
  const afterAvg = await page.evaluate(() => window.__lpo.state.polygons[0].fill);
  check('average RGB sampling sets a colour', /^#[0-9a-f]{6}$/.test(afterAvg), `${beforeAvg} -> ${afterAvg}`);
  await page.click('#btn-avg-lab');
  const afterLab = await page.evaluate(() => window.__lpo.state.polygons[0].fill);
  check('average LAB sampling sets a colour', /^#[0-9a-f]{6}$/.test(afterLab), afterLab);

  // ---- Eyedropper with magnifier
  await page.click('#tool-eyedropper');
  const redPoint = await stagePointFromImage(10, 32);
  await page.mouse.move(redPoint.x, redPoint.y);
  const magnifierVisible = await page.evaluate(() => !document.getElementById('magnifier').hidden);
  check('magnifier appears while hovering', magnifierVisible);
  await page.mouse.click(redPoint.x, redPoint.y);
  const eyedropped = await page.evaluate(() => window.__lpo.state.polygons[0].fill);
  check('eyedropper samples the red region of the original image', eyedropped === '#ff0000', eyedropped);

  // Composite sampling should differ from the original once a fill is on top.
  await page.check('#eye-mode-composite');
  const compositePoint = await stagePointFromImage(10, 32);
  await page.mouse.move(compositePoint.x, compositePoint.y);
  const compositeHex = await page.evaluate(() => document.querySelector('.magnifier-label').textContent);
  check('composite sampling reports a colour', /#[0-9a-f]{6}/.test(compositeHex), compositeHex);

  // ---- Opacity
  await page.evaluate(() => {
    const el = document.getElementById('opacity-range');
    el.value = '40';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const opacity = await page.evaluate(() => window.__lpo.state.polygons[0].opacity);
  check('opacity slider updates the polygon', Math.abs(opacity - 0.4) < 0.001, String(opacity));

  // ---- X-ray mode hides fills but keeps outlines
  await page.click('#chk-xray');
  const xray = await page.evaluate(() => ({
    xray: window.__lpo.state.settings.xray,
    fillOpacity: document.querySelector('#polygon-layer polygon').getAttribute('fill-opacity'),
    outlines: document.querySelectorAll('#outline-layer polygon').length,
  }));
  check('x-ray hides fills', xray.xray && xray.fillOpacity === '0');
  check('x-ray keeps outlines', xray.outlines >= 2);
  await page.click('#chk-xray');

  // ---- Background visibility toggle
  await page.click('#chk-bg');
  const bgHidden = await page.evaluate(() => document.getElementById('bg-layer').getAttribute('visibility'));
  check('background can be hidden independently', bgHidden === 'hidden');
  await page.click('#chk-bg');

  // ---- Polygon list selection
  const listCount = await page.locator('#polygon-list .polygon-item').count();
  check('polygon list mirrors the artwork', listCount === 2, String(listCount));
  await page.locator('#polygon-list .polygon-item').last().click();
  const listSelected = await page.evaluate(() => window.__lpo.state.selection.length);
  check('selecting from the list works', listSelected === 1);

  // ---- Delete selected polygon + undo
  const beforeDelete = await page.evaluate(() => window.__lpo.state.polygons.length);
  await page.click('#btn-delete');
  const afterDelete = await page.evaluate(() => window.__lpo.state.polygons.length);
  check('delete removes the selected polygon', afterDelete === beforeDelete - 1);
  await page.keyboard.press('Control+z');
  check(
    'undo restores the deleted polygon',
    (await page.evaluate(() => window.__lpo.state.polygons.length)) === beforeDelete,
  );

  // ---- Subdivision (stretch goal)
  await page.evaluate(() => {
    window.__lpo.state.selection = [window.__lpo.state.polygons[0].id];
    window.__lpo.renderPanel();
  });
  await page.evaluate(() => {
    const el = document.getElementById('subdiv-range');
    el.value = '1';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#btn-subdiv-preview');
  const previewCount = await page.evaluate(() => document.querySelectorAll('#subdiv-layer polygon').length);
  check('subdivision preview renders faces', previewCount === 3, String(previewCount));
  await page.selectOption('#subdiv-color-mode', 'rgb');
  await page.click('#btn-subdiv-apply');
  const subdiv = await page.evaluate(() => ({
    count: window.__lpo.state.polygons.length,
    selected: window.__lpo.state.selection.length,
  }));
  check('subdivision applies as editable faces', subdiv.count >= 3 && subdiv.selected >= 3, JSON.stringify(subdiv));
  await page.keyboard.press('Control+z');
  check(
    'subdivision undoes as one action',
    (await page.evaluate(() => window.__lpo.state.polygons.length)) === beforeDelete,
  );

  // ---- Exports
  await page.click('#btn-export');
  const svgPath = await grabDownload('#btn-export-svg');
  const svgText = await readFileAsync(svgPath, 'utf8');
  check('SVG export is standalone vector art', svgText.includes('<svg') && svgText.includes('<polygon'));
  check('SVG export excludes the raster background by default', !svgText.includes('<image '));

  const svgImagePath = await grabDownload('#btn-export-svg-image');
  const svgImageText = await readFileAsync(svgImagePath, 'utf8');
  check('SVG-with-image export embeds the image', svgImageText.includes('<image '));

  const compositePath = await grabDownload('#btn-export-composite');
  const compositeBytes = await readFile(compositePath);
  check(
    'composite PNG export is a valid PNG',
    compositeBytes[0] === 0x89 && compositeBytes.subarray(1, 4).toString() === 'PNG',
  );

  const polygonPath = await grabDownload('#btn-export-polygons');
  const polygonBytes = await readFile(polygonPath);
  check(
    'transparent polygon PNG export is a valid PNG',
    polygonBytes[0] === 0x89 && polygonBytes.subarray(1, 4).toString() === 'PNG',
  );

  const originalPath = await grabDownload('#btn-export-original');
  const originalBytes = await readFile(originalPath);
  check('original image PNG export is valid', originalBytes[0] === 0x89 && originalBytes.subarray(1, 4).toString() === 'PNG');

  const projectPath = await grabDownload('#btn-export-project');
  const projectJson = JSON.parse(await readFileAsync(projectPath, 'utf8'));
  check('project export contains an embedded image', projectJson.image.dataUrl.startsWith('data:image/png'));
  check('project export contains polygons', Array.isArray(projectJson.polygons) && projectJson.polygons.length >= 2);

  // ---- Clear the artwork, then reload the saved project
  const polygonCountBefore = await page.evaluate(() => window.__lpo.state.polygons.length);
  check('project save reflects the current artwork', projectJson.polygons.length === polygonCountBefore);
  await page.evaluate(() => {
    const { state } = window.__lpo;
    state.selection = state.polygons.map((p) => p.id);
    state.polygons = [];
    state.selection = [];
    window.__lpo.render();
    window.__lpo.renderPanel();
  });
  check('artwork cleared before reload', (await page.evaluate(() => window.__lpo.state.polygons.length)) === 0);

  await page.setInputFiles('#project-input', projectPath);
  await page.waitForFunction(
    (expected) => window.__lpo.state.polygons.length === expected,
    polygonCountBefore,
    { timeout: 5000 },
  );
  const reloaded = await page.evaluate(() => ({
    polys: window.__lpo.state.polygons.length,
    hasImage: !!window.__lpo.state.image,
    fills: window.__lpo.state.polygons.map((p) => p.fill),
  }));
  check('project reload restores polygons and image', reloaded.polys === polygonCountBefore && reloaded.hasImage);
  check('project reload restores colours', reloaded.fills.every((f) => /^#[0-9a-f]{6}$/.test(f)));

  // ---- Vertex snapping ------------------------------------------------
  // Close the export modal left open above (its overlay would swallow pointer
  // events) and return to the select tool, which the eyedropper test left active.
  await page.click('#btn-export-close');
  await page.click('#tool-select');
  await page.evaluate(() => {
    const { state, render, renderPanel } = window.__lpo;
    const face = (id, x) => ({
      id,
      vertices: [
        { x, y: 10 },
        { x: x + 20, y: 10 },
        { x: x + 20, y: 30 },
        { x, y: 30 },
      ],
      fill: '#8a8f98',
      opacity: 1,
      visible: true,
      texture: null,
    });
    state.polygons = [face('snap-a', 10), face('snap-b', 35)];
    state.selection = ['snap-b'];
    render();
    renderPanel();
  });

  const screenOf = (polygonIndex, vertexIndex) =>
    page.evaluate(
      ([pi, vi]) => {
        const { state } = window.__lpo;
        const v = state.polygons[pi].vertices[vi];
        const rect = document.getElementById('stage').getBoundingClientRect();
        return { x: rect.left + v.x * state.view.scale + state.view.tx, y: rect.top + v.y * state.view.scale + state.view.ty };
      },
      [polygonIndex, vertexIndex],
    );

  // Dragging a vertex so it lands a few screen px from another polygon's vertex
  // must lock it exactly onto that vertex.
  const targetScreen = await screenOf(0, 2); // snap-a's (30, 30)
  const grabScreen = await screenOf(1, 3); // snap-b's (35, 30)
  await page.mouse.move(grabScreen.x, grabScreen.y);
  await page.mouse.down();
  await page.mouse.move(targetScreen.x + 4, targetScreen.y + 3, { steps: 6 });
  const snapIndicator = await page.evaluate(() => document.querySelectorAll('.snap-target').length);
  check('snap indicator shows the vertex being locked onto', snapIndicator === 1, String(snapIndicator));
  await page.mouse.up();
  const snappedVertex = await page.evaluate(() => window.__lpo.state.polygons[1].vertices[3]);
  check(
    'dragging a vertex snaps it exactly onto a neighbouring vertex',
    Math.abs(snappedVertex.x - 30) < 1e-6 && Math.abs(snappedVertex.y - 30) < 1e-6,
    JSON.stringify(snappedVertex),
  );

  // Shift bypasses snapping for that edit, so the point stays where it was put.
  await page.keyboard.press('Control+z');
  await page.mouse.move(grabScreen.x, grabScreen.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(targetScreen.x + 4, targetScreen.y + 3, { steps: 6 });
  const shiftIndicator = await page.evaluate(() => document.querySelectorAll('.snap-target').length);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const unsnappedVertex = await page.evaluate(() => window.__lpo.state.polygons[1].vertices[3]);
  check('Shift disables snapping while dragging', shiftIndicator === 0 && Math.abs(unsnappedVertex.x - 30) > 1e-3, JSON.stringify(unsnappedVertex));
  await page.keyboard.press('Control+z');

  // Placing a vertex near an existing one snaps on click, and the toolbar button
  // turns the behaviour off entirely.
  await page.click('#tool-draw');
  await page.mouse.click(targetScreen.x + 5, targetScreen.y + 4);
  const placedVertex = await page.evaluate(() => window.__lpo.state.drawing.vertices[0]);
  check(
    'a clicked vertex snaps to a nearby vertex',
    Math.abs(placedVertex.x - 30) < 1e-6 && Math.abs(placedVertex.y - 30) < 1e-6,
    JSON.stringify(placedVertex),
  );
  await page.keyboard.press('Escape');

  await page.click('#btn-snap');
  await page.mouse.click(targetScreen.x + 5, targetScreen.y + 4);
  const freeVertex = await page.evaluate(() => window.__lpo.state.drawing.vertices[0]);
  check('the Snap button disables snapping', Math.abs(freeVertex.x - 30) > 1e-3, JSON.stringify(freeVertex));
  await page.keyboard.press('Escape');
  await page.click('#btn-snap');
  check('snap toggle stays in sync with the checkbox', await page.isChecked('#chk-snap'));
  await page.click('#tool-select');

  // ---- Image-sampled texture ------------------------------------------
  await page.evaluate(() => {
    const { state, render, renderPanel } = window.__lpo;
    state.polygons = [{
      id: 'tex',
      vertices: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
        { x: 10, y: 30 },
      ],
      fill: '#8a8f98',
      opacity: 1,
      visible: true,
      texture: null,
    }];
    state.selection = ['tex'];
    render();
    renderPanel();
  });
  await page.fill('#texture-tile-w', '5');
  await page.fill('#texture-tile-h', '5');
  await page.click('#btn-texture-sample');
  await page.waitForFunction(() => window.__lpo.state.polygons[0].texture !== null);

  const textureInfo = await page.evaluate(async () => {
    const { state } = window.__lpo;
    const texture = state.polygons[0].texture;
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = texture.href;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const got = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Independently rebuild the expected block straight from the source pixels.
    const source = state.image.imageData;
    const left = Math.round(texture.anchor.x - texture.tileWidth / 2);
    const top = Math.round(texture.anchor.y - texture.tileHeight / 2);
    let matches = 0;
    let total = 0;
    for (let y = 0; y < texture.tileHeight; y++) {
      for (let x = 0; x < texture.tileWidth; x++) {
        const sx = Math.min(source.width - 1, Math.max(0, left + x));
        const sy = Math.min(source.height - 1, Math.max(0, top + y));
        const s = (sy * source.width + sx) * 4;
        const d = (y * texture.tileWidth + x) * 4;
        total += 1;
        if (got.data[d] === source.data[s] && got.data[d + 1] === source.data[s + 1] && got.data[d + 2] === source.data[s + 2]) {
          matches += 1;
        }
      }
    }

    return {
      mode: texture.mode,
      tileWidth: texture.tileWidth,
      tileHeight: texture.tileHeight,
      href: texture.href,
      anchor: { ...texture.anchor },
      decodedWidth: img.naturalWidth,
      decodedHeight: img.naturalHeight,
      matches,
      total,
      firstPixel: [got.data[0], got.data[1], got.data[2]],
    };
  });

  check(
    'sampled texture records the requested tile size',
    textureInfo.mode === 'sample' && textureInfo.tileWidth === 5 && textureInfo.tileHeight === 5,
    JSON.stringify(textureInfo.mode),
  );
  check('sampled texture is a PNG data URL', /^data:image\/png;base64,/.test(textureInfo.href));
  check('the tile decodes to exactly the requested pixel grid', textureInfo.decodedWidth === 5 && textureInfo.decodedHeight === 5);
  check(
    'the tile is the exact pixel block from under the polygon',
    textureInfo.matches === textureInfo.total,
    `${textureInfo.matches}/${textureInfo.total}`,
  );
  check('the tile is grabbed from the polygon centre', Math.abs(textureInfo.anchor.x - 20) < 0.5 && Math.abs(textureInfo.anchor.y - 20) < 0.5, JSON.stringify(textureInfo.anchor));
  check('the tile carries the colour under the polygon', textureInfo.firstPixel[0] > 200 && textureInfo.firstPixel[2] < 60, textureInfo.firstPixel.join(','));

  const textureRender = await page.evaluate(() => {
    const node = document.querySelector('#polygon-layer polygon');
    return { fill: node.getAttribute('fill'), patterns: document.querySelectorAll('#svg-defs pattern').length };
  });
  check('the polygon renders with the tiled pattern', /^url\(#tex/.test(textureRender.fill) && textureRender.patterns >= 1, JSON.stringify(textureRender));

  // Move the polygon so its centre lands over the other half of the image: the
  // tile must follow the polygon and pick up the new pixels underneath it.
  await page.evaluate(() => {
    window.__lpo.state.polygons[0].vertices = window.__lpo.state.polygons[0].vertices.map((v) => ({ x: v.x + 20, y: v.y + 20 }));
    window.__lpo.render();
  });
  const beforeResample = await page.evaluate(() => window.__lpo.state.polygons[0].texture.href);
  await page.click('#btn-texture-sample');
  // Re-sampling is async (the tile is decoded for PNG export), so wait for the
  // new anchor rather than reading immediately.
  await page.waitForFunction(() => Math.abs(window.__lpo.state.polygons[0].texture.anchor.x - 40) < 0.5);
  const resampled = await page.evaluate(() => ({
    href: window.__lpo.state.polygons[0].texture.href,
    anchor: { ...window.__lpo.state.polygons[0].texture.anchor },
  }));
  check(
    're-sampling follows the polygon (new centre, new pixels)',
    Math.abs(resampled.anchor.x - 40) < 0.5 && resampled.href !== beforeResample,
    JSON.stringify(resampled.anchor),
  );

  await page.click('#btn-export');
  const texturedSvg = await grabDownload('#btn-export-svg');
  const texturedSvgText = await readFileAsync(texturedSvg, 'utf8');
  check('sampled textures survive SVG export as patterns', texturedSvgText.includes('<pattern') && /fill="url\(#tex/.test(texturedSvgText));
  await page.click('#btn-export-close');

  await page.click('#btn-texture-clear');
  check('the texture can be cleared', (await page.evaluate(() => window.__lpo.state.polygons[0].texture)) === null);

  // ---- Gradient removal: a tiny tile omits large-scale shading ---------
  const gradientUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    for (let x = 0; x < 64; x++) {
      const v = Math.round((x / 63) * 255);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, 0, 1, 64);
    }
    return canvas.toDataURL('image/png');
  });
  await page.setInputFiles('#file-input', {
    name: 'gradient.png',
    mimeType: 'image/png',
    buffer: Buffer.from(gradientUrl.split(',')[1], 'base64'),
  });
  await page.waitForFunction(() => window.__lpo.state.image?.name === 'gradient.png');
  await page.evaluate(() => {
    const { state, render, renderPanel } = window.__lpo;
    state.polygons = [{
      id: 'grad',
      vertices: [
        { x: 4, y: 20 },
        { x: 60, y: 20 },
        { x: 60, y: 44 },
        { x: 4, y: 44 },
      ],
      fill: '#8a8f98',
      opacity: 1,
      visible: true,
      texture: null,
    }];
    state.selection = ['grad'];
    render();
    renderPanel();
  });
  await page.fill('#texture-tile-w', '9');
  await page.fill('#texture-tile-h', '9');
  await page.click('#btn-texture-sample');
  await page.waitForFunction(() => window.__lpo.state.polygons[0].texture?.tileWidth === 9);

  const gradientResult = await page.evaluate(async () => {
    const { state } = window.__lpo;
    const texture = state.polygons[0].texture;
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = texture.href;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const tile = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let tileMin = 255;
    let tileMax = 0;
    for (let i = 0; i < tile.length; i += 4) {
      tileMin = Math.min(tileMin, tile[i]);
      tileMax = Math.max(tileMax, tile[i]);
    }

    // Range of the source pixels the polygon actually covers (the gradient is
    // horizontal, so sampling one row across the polygon's x span is exact).
    const source = state.image.imageData;
    const xs = state.polygons[0].vertices.map((v) => v.x);
    const row = Math.round(state.polygons[0].texture.anchor.y);
    let srcMin = 255;
    let srcMax = 0;
    for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(source.width - 1, Math.ceil(Math.max(...xs))); x++) {
      const value = source.data[(row * source.width + x) * 4];
      srcMin = Math.min(srcMin, value);
      srcMax = Math.max(srcMax, value);
    }

    return {
      tileRange: tileMax - tileMin,
      sourceRange: srcMax - srcMin,
      tileSize: texture.tileWidth,
    };
  });
  check(
    'the sampled tile drops the large-scale gradient',
    gradientResult.sourceRange > 150 &&
      gradientResult.tileRange > 0 &&
      gradientResult.tileRange < gradientResult.sourceRange * 0.4,
    JSON.stringify(gradientResult),
  );

  check('no console errors during the whole session', consoleErrors.length === 0, consoleErrors.join(' | '));

  await browser.close();
  server.close();

  console.log('\nBrowser smoke test passed:');
  for (const line of results) console.log('  ' + line);
  console.log(`\n${results.length} checks passed.`);
}

main().catch((error) => {
  console.error('\nBrowser smoke test FAILED:\n', error);
  process.exit(1);
});
