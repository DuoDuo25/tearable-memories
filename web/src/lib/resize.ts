/**
 * Browser-side image resize. Phones routinely hand us 5–25 MB JPEG/HEIC
 * monsters; this brings them down to ~3840 px on the long side at JPEG q90,
 * matching what the engine expects from web/public/photos/* in the bundled
 * default. Result fits well under the 5 MB server cap.
 *
 * Uses a regular <canvas>; OffscreenCanvas would also work but isn't worth
 * the polyfill — this runs once per upload, not per frame.
 */

export interface ResizedImage {
  blob: Blob;
  contentType: string;
  bytes: number;
  width: number;
  height: number;
}

// 3840 px on the LONG edge. Why not 2560: cover-mode crop on a portrait
// phone fits the photo's *short* edge to viewport height (~2556 device px
// at iPhone 14 Pro). For a 3:2 landscape photo to fill that without
// upscaling, its long edge must be 2556 × 1.5 ≈ 3834. 2560 was a previous
// optimization mistake — it forced a 1.5× upsample on landscape photos
// rendered into portrait viewports, which read as soft / mushy.
//
// WebP at q88 keeps visual quality on par with JPEG q92 while being ~3×
// smaller, so we get retina-perfect AND not-too-slow on cellular.
const TARGET_LONG_EDGE = 3840;
const QUALITY = 0.88;
const OUTPUT_TYPE = 'image/webp';

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

  const blob = await new Promise<Blob>((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), OUTPUT_TYPE, QUALITY);
  });

  return { blob, contentType: OUTPUT_TYPE, bytes: blob.size, width: w, height: h };
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
