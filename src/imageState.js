/**
 * Image state.
 *
 * Holds the decoded image together with an offscreen canvas and its pixel data.
 * The offscreen canvas is the single source of truth for colour sampling and
 * the eyedropper magnifier, which keeps sampling fast (one `getImageData` per
 * imported image) and guarantees the original image is never modified.
 */

export function createImageState(img, dataUrl, name) {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch (error) {
    // getImageData can throw for cross-origin images; sampling then degrades
    // gracefully rather than breaking the editor.
    imageData = null;
    console.warn('Colour sampling unavailable:', error);
  }

  return {
    img,
    canvas,
    ctx,
    imageData,
    width,
    height,
    dataUrl,
    name: name || 'image',
  };
}

/** Draw the (possibly scaled) source image to a canvas for export. */
export function drawImageToCanvas(ctx, imageState, width, height) {
  if (!imageState) return;
  ctx.drawImage(imageState.img, 0, 0, width, height);
}
