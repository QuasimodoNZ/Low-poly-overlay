import test from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../src/history.js';

test('undo and redo restore snapshots in order', () => {
  const history = new History();
  history.record({ value: 1 });
  history.record({ value: 2 });

  assert.equal(history.canUndo(), true);
  assert.equal(history.canRedo(), false);

  const prev = history.undo({ value: 3 });
  assert.deepEqual(prev, { value: 2 });
  assert.deepEqual(history.undo({ value: 2 }), { value: 1 });
  assert.equal(history.canUndo(), false);

  const next = history.redo({ value: 1 });
  assert.deepEqual(next, { value: 2 });
});

test('recording clears the redo stack', () => {
  const history = new History();
  history.record({ value: 1 });
  history.undo({ value: 2 });
  assert.equal(history.canRedo(), true);
  history.record({ value: 3 });
  assert.equal(history.canRedo(), false);
});

test('snapshots are deep-cloned (later mutations do not leak)', () => {
  const history = new History();
  const snapshot = { polygons: [{ vertices: [{ x: 0, y: 0 }] }] };
  history.record(snapshot);
  snapshot.polygons[0].vertices[0].x = 999;

  const restored = history.undo({ polygons: [] });
  assert.equal(restored.polygons[0].vertices[0].x, 0);
});

test('history respects its limit', () => {
  const history = new History(3);
  for (let i = 0; i < 10; i++) history.record({ value: i });
  let count = 0;
  while (history.canUndo()) {
    history.undo({});
    count++;
  }
  assert.equal(count, 3);
});

test('undo on an empty history returns null', () => {
  const history = new History();
  assert.equal(history.undo({ value: 1 }), null);
  assert.equal(history.redo({ value: 1 }), null);
});
