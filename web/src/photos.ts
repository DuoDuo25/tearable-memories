import type { Photo } from './engine';

/**
 * Aini's default template — the album visitors see at "/".
 * Order: top of array = first thing visible; user tears down through the array.
 * After all 3 are torn, the hidden ending reveals.
 */
export const DEFAULT_PHOTOS: Photo[] = [
  { src: '/photos/01-lacha.jpg',     title: '2026-04-29', subtitle: '@Lacha Thailand' },
  { src: '/photos/02-rome.jpg',      title: '2025-10-10', subtitle: '@Rome Italy' },
  { src: '/photos/03-edinburgh.jpg', title: '2025-01-28', subtitle: '@Edinburgh United Kingdom' },
];

export const DEFAULT_ENDING = {
  title: '看到这里',
  sub: '说明你是一个很有趣的人',
  ctaLabel: '上传我的照片',
};
