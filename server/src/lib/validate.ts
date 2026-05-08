/**
 * Album-input validation, shared by POST and PUT.
 *
 * Returns `null` on success, or a `{ status, message }` pair to forward as
 * the HTTP error response.
 */

export interface PhotoInput {
  title?: string;
  subtitle?: string;
  contentType?: string;
  bytes?: number;
}

export interface AlbumInput {
  photos: PhotoInput[];
  ending_title?: string;
  ending_sub?: string;
  cta_label?: string;
}

export const LIMITS = {
  minPhotos: 1,
  maxPhotos: 5,
  maxBytesPerPhoto: 5 * 1024 * 1024,    // 5MB after client resize
  captionMaxLen: 80,
  endingTitleMaxLen: 80,
  endingSubMaxLen: 200,
  ctaMaxLen: 32,
};

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type ValidationError = { status: 400 | 413 | 415 | 422; message: string };

export function validateAlbumInput(input: AlbumInput): ValidationError | null {
  if (!Array.isArray(input.photos)) {
    return { status: 422, message: 'photos must be an array' };
  }
  if (input.photos.length < LIMITS.minPhotos || input.photos.length > LIMITS.maxPhotos) {
    return { status: 422, message: `photos must have between ${LIMITS.minPhotos} and ${LIMITS.maxPhotos} entries` };
  }

  for (let i = 0; i < input.photos.length; i++) {
    const p = input.photos[i];
    if (typeof (p.title ?? '') !== 'string' || (p.title ?? '').length > LIMITS.captionMaxLen) {
      return { status: 422, message: `photos[${i}].title must be ≤${LIMITS.captionMaxLen} chars` };
    }
    if (typeof (p.subtitle ?? '') !== 'string' || (p.subtitle ?? '').length > LIMITS.captionMaxLen) {
      return { status: 422, message: `photos[${i}].subtitle must be ≤${LIMITS.captionMaxLen} chars` };
    }
    if (p.contentType && !ALLOWED_CONTENT_TYPES.has(p.contentType)) {
      return { status: 415, message: `photos[${i}].contentType must be one of jpeg/png/webp` };
    }
    if (typeof p.bytes === 'number') {
      if (p.bytes <= 0 || p.bytes > LIMITS.maxBytesPerPhoto) {
        return { status: 413, message: `photos[${i}].bytes must be between 1 and ${LIMITS.maxBytesPerPhoto}` };
      }
    }
  }

  if (input.ending_title && input.ending_title.length > LIMITS.endingTitleMaxLen) {
    return { status: 422, message: `ending_title must be ≤${LIMITS.endingTitleMaxLen} chars` };
  }
  if (input.ending_sub && input.ending_sub.length > LIMITS.endingSubMaxLen) {
    return { status: 422, message: `ending_sub must be ≤${LIMITS.endingSubMaxLen} chars` };
  }
  if (input.cta_label && input.cta_label.length > LIMITS.ctaMaxLen) {
    return { status: 422, message: `cta_label must be ≤${LIMITS.ctaMaxLen} chars` };
  }

  return null;
}

export function fileExtFor(contentType: string | undefined): string {
  switch (contentType) {
    case 'image/png':  return 'png';
    case 'image/webp': return 'webp';
    default:           return 'jpg';
  }
}
