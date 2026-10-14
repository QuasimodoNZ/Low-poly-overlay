import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const app = readFileSync(join(root, 'src', 'app.js'), 'utf8');

/** Pull the `const ids = [...]` list out of cacheElements(). */
function cachedIds(source) {
  const match = source.match(/const ids = \[([\s\S]*?)\];/);
  assert.ok(match, 'cacheElements() id list found');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('every cached element id exists in index.html', () => {
  const ids = cachedIds(app);
  assert.ok(ids.length > 30, 'expected a substantial id list');
  const missing = ids.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `missing ids: ${missing.join(', ')}`);
});

test('no duplicate ids in index.html', () => {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  const duplicates = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  assert.deepEqual(duplicates, []);
});

test('index.html loads the app as a module and has no inline scripts', () => {
  assert.match(html, /<script type="module" src="src\/app\.js"><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/);
});
