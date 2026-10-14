/**
 * Eyedropper magnifier.
 *
 * Renders a zoomed, pixel-accurate view of the original image around the
 * pointer, marks the exact sampling pixel and shows a grid when zoomed far
 * enough in. The widget itself is plain DOM so it can float over the SVG.
 */

const CHECKER_LIGHT = '#3a3f46';
const CHECKER_DARK = '#2c3036';

export class Magnifier {
  constructor(root, options = {}) {
    this.root = root;
    this.size = options.size || 160;
    this.zoom = options.zoom || 8;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.canvas.className = 'magnifier-canvas';
    this.ctx = this.canvas.getContext('2d');

    this.readout = document.createElement('div');
    this.readout.className = 'magnifier-readout';

    this.swatch = document.createElement('span');
    this.swatch.className = 'magnifier-swatch';

    this.label = document.createElement('span');
    this.label.className = 'magnifier-label';

    this.readout.append(this.swatch, this.label);
    this.root.append(this.canvas, this.readout);
    this.root.hidden = true;
  }

  hide() {
    this.root.hidden = true;
  }

  setZoom(zoom) {
    this.zoom = zoom;
  }

  /**
   * @param {{x:number,y:number}} point   sampling point in image coordinates
   * @param {object} imageState           source image state (may be null)
   * @param {object} info                 { hex, mode, label }
   * @param {{x:number,y:number}} screen  position of the magnifier in the workspace
   */
  show(point, imageState, info, screen) {
    this.root.hidden = false;
    this.position(screen);
    this.draw(point, imageState);

    if (info && info.hex) {
      this.swatch.style.background = info.hex;
      this.label.textContent = `${info.hex} · ${info.mode}`;
    }
  }

  position(screen) {
    const offset = 18;
    const parent = this.root.parentElement;
    const parentRect = parent ? parent.getBoundingClientRect() : { width: 0, height: 0 };
    let left = screen.x + offset;
    let top = screen.y + offset;

    const totalWidth = this.size + 16;
    const totalHeight = this.size + 42;

    if (left + totalWidth > parentRect.width) left = screen.x - totalWidth - offset;
    if (top + totalHeight > parentRect.height) top = screen.y - totalHeight - offset;

    this.root.style.left = `${Math.max(4, left)}px`;
    this.root.style.top = `${Math.max(4, top)}px`;
  }

  draw(point, imageState) {
    const ctx = this.ctx;
    const size = this.size;
    const zoom = this.zoom;
    const sampleW = size / zoom;
    const sampleH = size / zoom;
    const originX = point.x - sampleW / 2;
    const originY = point.y - sampleH / 2;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);

    // Checkerboard so out-of-image areas and transparency are visible.
    const cell = 8;
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        ctx.fillStyle = ((x / cell + y / cell) % 2 === 0) ? CHECKER_LIGHT : CHECKER_DARK;
        ctx.fillRect(x, y, cell, cell);
      }
    }

    if (imageState) {
      ctx.drawImage(
        imageState.canvas,
        originX,
        originY,
        sampleW,
        sampleH,
        0,
        0,
        size,
        size,
      );
    }

    // Pixel grid when zoomed in far enough.
    if (zoom >= 4) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      const firstX = Math.ceil(originX);
      for (let x = firstX; x < originX + sampleW; x++) {
        const sx = Math.round((x - originX) * zoom) + 0.5;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, size);
        ctx.stroke();
      }
      const firstY = Math.ceil(originY);
      for (let y = firstY; y < originY + sampleH; y++) {
        const sy = Math.round((y - originY) * zoom) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(size, sy);
        ctx.stroke();
      }
    }

    // Mark the exact sampling pixel.
    const px = Math.floor(point.x);
    const py = Math.floor(point.y);
    const markerX = (px - originX) * zoom;
    const markerY = (py - originY) * zoom;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(markerX + 1, markerY + 1, zoom - 2, zoom - 2);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(markerX + 2, markerY + 2, zoom - 4, zoom - 4);

    // Centre crosshair.
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();
  }
}
