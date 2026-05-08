/**
 * Tiny nanoid-style URL-safe random ID generator. We avoid the npm package
 * to keep server deps minimal — `crypto.getRandomValues` is available in the
 * Workers runtime. Alphabet is the standard nanoid one (64 URL-safe chars).
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-';

function nanoid(size: number): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < size; i++) id += ALPHABET[bytes[i] & 63];
  return id;
}

/** 8-char public album id — collision-safe for ~hundreds of millions of albums. */
export const newAlbumId = () => nanoid(8);

/** 32-char private edit token — large enough to be unguessable in practice. */
export const newEditToken = () => nanoid(32);
