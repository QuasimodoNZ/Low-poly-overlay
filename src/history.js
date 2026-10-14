/**
 * Snapshot-based undo/redo history.
 *
 * A snapshot is any JSON-cloneable value. The editor records the polygons array
 * (plus the current selection) before each meaningful change, so undo/redo is
 * trivially correct and works for drawing, editing, moving, recolouring,
 * deleting and subdivision alike.
 *
 * Kept free of DOM references so it can be unit-tested in Node.
 */

function deepClone(value) {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

export class History {
  constructor(limit = 80) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }

  reset() {
    this.past = [];
    this.future = [];
  }

  canUndo() {
    return this.past.length > 0;
  }

  canRedo() {
    return this.future.length > 0;
  }

  /** Record a snapshot that represents the state *before* a change. */
  record(snapshot) {
    this.past.push(deepClone(snapshot));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /**
   * Step backwards. `current` is the present state (pushed onto the redo stack)
   * and the returned value is the previous state. Returns null when empty.
   */
  undo(current) {
    if (!this.canUndo()) return null;
    const previous = this.past.pop();
    this.future.push(deepClone(current));
    return previous;
  }

  redo(current) {
    if (!this.canRedo()) return null;
    const next = this.future.pop();
    this.past.push(deepClone(current));
    return next;
  }
}
