/**
 * Browser-side image resize. Phones routinely hand us 5–25 MB JPEG/HEIC
 * monsters; this brings them down to ~3840 px on the long side and a
 * compressed format that fits comfortably under the 5 MB server cap.
 *
 * Why two-format encode (WebP → JPEG fallback): iOS Safari historically
 * has flaky `canvas.toBlob('image/webp', q)` support — depending on the
 * iOS version, it either ignores the type and returns PNG (which can
 * easily be 10+ MB and overflow the server cap) or returns an empty/
 * tiny blob. Try WebP first because it's ~3× smaller for the same visual
 * quality, then sanity-check (size > 1 KB AND blob.type really is webp);
 * if either check fails, re-encode as JPEG which is universally
 * supported and only marginally bigger at q90.
 */

export interface ResizedImage {
  blob: Blob;
  contentType: string;
  bytes: number;
  width: number;
  height: number;
}

const TARGET_LONG_EDGE = 3840;
const SERVER_MAX_BYTES = 5 * 1024 * 1024;

export async function resizeImage(file: File): Promise<ResizedImage> {
  const bitmap = await loadBitmap(file);
  const longEdge = Math.max(bitmap.width, bitmap.height);
  const scale = longEdge > TARGET_LONG_EDGE ? TARGET_LONG_EDGE / longEdge : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ('close' in bitmap) bitmap.close();

  // Try WebP first; fall back to JPEG if Safari refused or returned PNG.
  let blob = await encodeBlob(c, 'image/webp', 0.88);
  if (!blob || blob.type !== 'image/webp' || blob.size < 1024) {
    blob = await encodeBlob(c, 'image/jpeg', 0.85);
  }
  if (!blob || blob.size === 0) {
    throw new Error('encoder produced an empty file');
  }
  // Last-ditch: if even JPEG comes back over the cap (huge image at high
  // quality), step the quality down until it fits.
  if (blob.size > SERVER_MAX_BYTES) {
    for (const q of [0.78, 0.7, 0.62, 0.55]) {
      const retry = await encodeBlob(c, 'image/jpeg', q);
      if (retry && retry.size <= SERVER_MAX_BYTES) { blob = retry; break; }
    }
    if (blob.size > SERVER_MAX_BYTES) {
      throw new Error(`image too large (${(blob.size / 1024 / 1024).toFixed(1)} MB) — try a smaller photo`);
    }
  }

  return {
    blob,
    contentType: blob.type || 'image/jpeg',
    bytes: blob.size,
    width: w,
    height: h,
  };
}

function encodeBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), type, quality);
  });
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // ImageBitmap is faster + handles EXIF orientation when supported.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fall through to <img> path
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('failed to decode image')); };
    img.src = url;
  });
}

/** Quick sniff so the picker can reject obviously-wrong files before resize. */
export function isImageFile(file: File): boolean {
  return /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) ||
         /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
}
