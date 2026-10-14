/**
 * Project save / load.
 *
 * A project file is a single self-contained JSON document. The original image
 * (and any textures) are embedded as data URLs so a saved project never depends
 * on a local file path staying valid.
 */

import { createPolygon, createDefaultSettings } from './model.js';
import { serializePolygons } from './model.js';

export const PROJECT_FORMAT = 'low-poly-overlay-project';
export const PROJECT_VERSION = 1;

export function serializeProject({ image, polygons, settings }) {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    createdAt: new Date().toISOString(),
    image: image
      ? {
          name: image.name || 'image',
          width: image.width,
          height: image.height,
          dataUrl: image.dataUrl,
        }
      : null,
    polygons: serializePolygons(polygons),
    settings: { ...createDefaultSettings(), ...(settings || {}) },
  };
}

export function projectToJSON(project) {
  return JSON.stringify(project, null, 2);
}

/**
 * Validate and normalise a parsed project file.
 * Returns `{ image, polygons, settings }`. Throws with a readable message when
 * the file is not a project.
 */
export function parseProject(raw) {
  let data;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('Project file is not valid JSON');
    }
  } else {
    data = raw;
  }

  if (!data || data.format !== PROJECT_FORMAT) {
    throw new Error('Not a Low-Poly Overlay project file');
  }

  const polygons = Array.isArray(data.polygons)
    ? data.polygons
        .filter((p) => p && Array.isArray(p.vertices) && p.vertices.length >= 3)
        .map((p) =>
          createPolygon(p.vertices, {
            id: p.id,
            fill: p.fill,
            opacity: p.opacity,
            visible: p.visible,
            name: p.name,
            texture: p.texture || null,
            meta: p.meta || {},
          }),
        )
    : [];

  return {
    image: data.image && data.image.dataUrl ? data.image : null,
    polygons,
    settings: { ...createDefaultSettings(), ...(data.settings || {}) },
  };
}

/** Load an image element from a data URL. */
export function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the embedded image'));
    img.src = dataUrl;
  });
}

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file supplied'));
      return;
    }
    if (!file.type.startsWith('image/')) {
      reject(new Error(`Unsupported file type: ${file.type || 'unknown'}`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      loadImageFromDataUrl(reader.result)
        .then((img) => resolve({ img, dataUrl: reader.result }))
        .catch(reject);
    };
    reader.onerror = () => reject(new Error('Could not read the image file'));
    reader.readAsDataURL(file);
  });
}
