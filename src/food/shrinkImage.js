// Turning a camera photo into something small enough to post.
//
// A phone photo is several megabytes; the worker accepts 1.5MB of base64. 1024px on the longest
// side is plenty for identifying food and keeps the request well inside that.
//
// `fitDimensions` is pure and tested; `shrinkImage` needs a browser (canvas, Image, FileReader).

const DEFAULT_MAX = 1024;
const DEFAULT_QUALITY = 0.8;

/**
 * Fit width x height inside a max-length square, preserving aspect ratio. Never upscales.
 * @returns {{ width: number, height: number }} whole pixels
 */
export function fitDimensions(width, height, max) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    // A very wide image would round its short side to 0 and make an unusable canvas.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const loadImage = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That photo couldn't be read.")); };
  img.src = url;
});

/**
 * @param {File} file
 * @returns {Promise<string>} base64 JPEG, no `data:` prefix
 */
export async function shrinkImage(file, max = DEFAULT_MAX, quality = DEFAULT_QUALITY) {
  const img = await loadImage(file);
  const { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight, max);
  if (!width || !height) throw new Error("That photo couldn't be read.");
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality).split(',')[1] || '';
}
