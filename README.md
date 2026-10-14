# Low-Poly Image Overlay Editor

A browser-based tool for making low-poly artwork: import an image, trace regions
of it with polygons, and give each polygon a flat colour — sampled from the
image, eyedropped, or picked by hand.

Everything runs locally in the browser. There is **no backend, no database, no
authentication, no build step and no network access required** after the files
are on disk. The original image is never modified; all edits are non-destructive
vector data layered on top of it.

---

## Running it

ES modules are used throughout, so the app must be served over HTTP (opening
`index.html` directly from the filesystem will not work in most browsers). Any
static file server is fine:

```bash
# Option 1 — Python (usually already installed)
python3 -m http.server 8000
# then open http://localhost:8000

# Option 2 — npm script
npm run serve      # same python server on port 8000

# Option 3 — any other static server, e.g.
npx serve .
```

No installation step is required — there are no runtime dependencies.

---

## Workflow

### 1. Import an image
Click **Import image**, or drag & drop a file onto the canvas. The image is
fitted to the workspace automatically. Its aspect ratio and resolution are
preserved, and a label shows its filename and dimensions.

### 2. Navigate
- **Wheel** — zoom in/out, centred on the cursor.
- **Middle-drag**, **Alt-drag**, or the **Pan** tool — pan around.
- **Fit** — fit the image to the screen.
- The `%` readout shows the current zoom level.

Coordinates are always stored in **original image pixels**, so zooming, panning
and resizing the window never change the artwork.

### 3. Draw polygons (Draw tool, `P`)
- **Click** to place vertices; a rubber-band preview follows the cursor.
- **Close** by clicking the first vertex, double-clicking, or pressing **Enter**.
- **Esc** cancels the polygon being drawn.
- New polygons get a colour sampled from the image (or the default colour if
  *Auto-colour from image* is turned off).

### 4. Edit polygons (Select tool, `V`)
- **Click** a polygon to select it; its vertices appear.
- **Drag a vertex** to reshape it (self-intersections are rejected live).
- **Drag the interior** to move the whole polygon.
- **Double-click an edge** to insert a vertex.
- Select a vertex and press **Delete** to remove that vertex (the polygon must
  keep at least 3 vertices).
- **Delete/Backspace** with no vertex selected deletes the polygon.
- Reorder with **Front / Raise / Lower / Back**.
- Overlapping polygons can be picked from the **Polygons** list in the panel.

### 5. Colour it
- **Colour picker / HEX / RGB fields** — manual colour.
- **Opacity slider** (and numeric entry) — per-polygon alpha.
- **Avg colour (RGB)** — mean colour of the image pixels *inside* the polygon
  (bounding-box corners are excluded; transparent pixels are ignored).
- **Avg (LAB)** — the same average computed in CIELAB for a perceptual result.
- **Eyedropper** (`I`) — sample a pixel and apply it to the selected polygon.

The eyedropper has two modes:
- **Original image** — reads the source image only.
- **Visible composite** — reads what is actually visible, accounting for
  polygon fills, their opacity and stacking order over the background.

A magnifier follows the cursor showing a zoomed pixel grid, the exact sampling
pixel and the sampled HEX colour. The polygon updates live while hovering and is
only committed (as one undo step) when you click; **Esc** or right-click cancels.

### 6. Trace through the image (X-ray)
**X-ray** hides every polygon fill while keeping outlines and vertices, so you
can see the original image clearly and keep drawing. Other display options:
outlines on/off, outline colour and width, vertices, selection highlight, global
overlay opacity, and background image on/off. These are display-only and never
touch the stored colours or geometry.

### 7. History
Undo/redo covers drawing, vertex edits, moves, colour changes, deletion,
reordering, subdivision and every other meaningful change.
`Ctrl/Cmd + Z` undo, `Ctrl/Cmd + Shift + Z` (or `Ctrl + Y`) redo.

---

## Exporting

Open **Export** in the toolbar:

| Option | Result |
| --- | --- |
| **Full composition · PNG** | Background image + all polygon fills, at the original pixel size (or a chosen scale). Editing UI is never included. |
| **Polygons only · transparent PNG** | The overlay alone with real alpha, aligned to the original image, no background and no editor UI. |
| **Original image · PNG** | The untouched source image. |
| **Polygons · SVG** | Standalone vector SVG (real `<polygon>` geometry, fills + opacity, transparent background) — editable in Illustrator/Inkscape/Figma. |
| **Polygons + image · SVG** | The same, with the original image embedded as a data URL so it opens as one file. |
| **Project file · JSON** | The whole project: polygons, colours, opacity, settings **and the embedded image**, so it can be reopened anywhere. |

A **resolution scale** (e.g. `2`) renders PNGs at a higher resolution.
*Respect current visibility* makes the composition export honour X-ray /
hidden-background state; leave it off to always export the complete artwork.

Projects can also be reopened via **Open project**, or by dragging a `.json`
project file onto the canvas (importing an image or project that would replace
existing work asks for confirmation first).

---

## Stretch features

- **Subdivision** — select a polygon, choose a *Detail* level, **Preview** then
  **Apply**. The polygon is triangulated with ear clipping (concave polygons are
  supported) and triangles are recursively split by their centroid, so faces
  never leave the original boundary, never overlap and never leave gaps. Each
  new face can inherit the original colour or be re-sampled from the image
  (RGB or LAB). The whole operation is a single undo step.
- **Texture fills** — load an image to use as a repeating fill on a polygon,
  with scale and offset controls. Textures are clipped by the polygon and
  survive zoom/pan and export (SVG pattern / canvas pattern).

Both are optional and isolated from the core flat-colour system.

---

## Shortcuts

| Key | Action |
| --- | --- |
| `V` / `P` / `I` / `H` | Select · Draw · Eyedropper · Pan |
| Click first point / dbl-click / `Enter` | Close the polygon |
| `Esc` | Cancel drawing · clear selection · cancel eyedropper |
| `Delete` / `Backspace` | Delete selected vertex, else polygon |
| Middle-drag / Alt-drag | Pan |
| `F` | Fit to screen |
| `+` / `-` | Zoom in / out |
| `Ctrl/Cmd + Z` / `Shift + Z` | Undo · Redo |
| `Ctrl/Cmd + S` / `O` | Save project · Open project |
| `?` | Shortcut reference |

---

## Project structure

```
index.html            markup: toolbar, workspace (SVG), properties panel, modals
styles.css            compact dark desktop-first layout
src/
  app.js              state, interaction, UI wiring, shortcuts, export UI
  geometry.js         pure geometry: point-in-polygon, validity, ear-clip
                      triangulation, subdivision, closest-edge, bounds
  sampling.js         pure colour maths: hex/rgb, CIELAB, polygon average,
                      alpha-aware compositing
  model.js            polygon/state factories + serialisation
  history.js          snapshot-based undo/redo
  imageState.js       decoded image + offscreen canvas/pixel data for sampling
  renderer.js         SVG rendering of background, polygons, outlines, previews
  magnifier.js        eyedropper magnifier widget
  exporter.js         SVG string generation + canvas/PNG rasterisation + downloads
  project.js          project save / load (embedded image data URLs)
scripts/
  browser-smoke.mjs   end-to-end browser test driving the real UI
test/                 Node unit tests (node:test, zero dependencies)
```

Design notes:

- **Coordinate system** — polygons are stored in original-image coordinates.
  The SVG renders them inside one `<g transform="translate(tx,ty) scale(s)">`,
  so the view transform is the only thing that changes on zoom/pan/resize.
- **Separation of concerns** — image, polygon geometry and editor display state
  are three independent pieces. Only polygons + selection take part in history.
- **Sampling** happens on an offscreen canvas of the original image, so the
  overlay never influences an "average colour" result.
- `geometry.js`, `sampling.js`, `history.js`, `model.js`, `project.js` and the
  string part of `exporter.js` are DOM-free and directly unit-testable in Node.

---

## Tests

```bash
npm test
```

Runs the Node unit tests (`node:test`, no dependencies) covering point-in-polygon,
polygon validity, signed area, triangulation (including concave polygons),
subdivision (area conservation, faces stay inside), colour conversions,
polygon-average sampling, alpha weighting, composite sampling and stacking
order, undo/redo semantics, SVG export output, project round-tripping, and a
DOM-contract check that every element id referenced by `app.js` exists in
`index.html`.

### Browser smoke test (optional)

`scripts/browser-smoke.mjs` boots the app on a temporary local server and drives
the real UI in headless Chromium: import, draw, close, edit vertices, undo/redo,
zoom/resize invariance, average sampling, eyedropper + magnifier, opacity,
X-ray, background toggle, list selection, delete, subdivision, every export
format, and a full project save → clear → reload cycle.

```bash
npm i --no-save playwright
npx playwright install chromium
node scripts/browser-smoke.mjs
```

(On a bare Linux container you may also need Chromium's system libraries — e.g.
`npx playwright install-deps chromium` if you have root.)

---

## Known limitations

- Colour sampling needs the image pixels to be readable; images that taint the
  canvas (unlikely for local files) fall back to no sampling rather than failing.
- Polygon fills are flat shapes; the magnifier shows the *original* image with a
  composite readout rather than re-rendering the blended overlay underneath.
- Subdivision produces triangles only (as allowed by the brief).
- Very large images with many polygons are fine, but a full re-render happens on
  every interaction; extremely dense artwork may eventually want incremental
  rendering.
- Vertex/edge hit testing, the eyedropper and the magnifier operate on the top
  polygons only where relevant; selection of an obscured polygon uses the list.

## Possible next steps

- Incremental/partial SVG rendering for very large polygon counts.
- Richer subdivision patterns (edge-midpoint splits, blue-noise interior points).
- Multi-polygon average-colour and bulk recolour tools.
- Export presets and keyboard-nudge for selected polygons.
- Optional snapping / shared vertices between adjacent polygons.
