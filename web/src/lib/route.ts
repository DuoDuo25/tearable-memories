/**
 * URL parser using hash-based routing.
 *
 * Why hash and not path? EdgeSpark's static-file serving falls back unknown
 * paths to the ROOT index.html, not the sub-directory's. So
 * `/tearable-memory/m/abc` would land the visitor on the hinihao hub page,
 * not the tearable app. By keeping the path stable at the build's BASE_URL
 * and moving routing into the hash, the file the server returns is always
 * the right one and JS handles the rest.
 *
 * Standalone deploy (BASE = '/'):
 *   /                       → template
 *   /#/m/<id>               → viewer
 *   /#/m/<id>/edit?t=<tok>  → editor
 *
 * Sub-path deploy (BASE = '/tearable-memory/'):
 *   /tearable-memory/                       → template
 *   /tearable-memory/#/m/<id>               → viewer
 *   /tearable-memory/#/m/<id>/edit?t=<tok>  → editor
 */

export type RouteIntent =
  | { kind: 'template' }
  | { kind: 'viewer'; id: string }
  | { kind: 'editor'; id: string; token: string };

const ID_RE = /^[A-Za-z0-9_-]{4,}$/;

/** The base path this build expects, with leading and trailing slashes. */
export const BASE_PATH = import.meta.env.BASE_URL; // e.g. '/' or '/tearable-memory/'

export function parseRoute(): RouteIntent {
  const rawHash = window.location.hash;
  if (!rawHash || rawHash === '#' || rawHash === '#/') return { kind: 'template' };

  // Strip leading # and (optional) /
  let stripped = rawHash.slice(1);
  if (stripped.startsWith('/')) stripped = stripped.slice(1);

  const qIdx = stripped.indexOf('?');
  const pathPart = qIdx >= 0 ? stripped.slice(0, qIdx) : stripped;
  const queryPart = qIdx >= 0 ? stripped.slice(qIdx + 1) : '';

  const editMatch = pathPart.match(/^m\/([^/]+)\/edit\/?$/);
  if (editMatch && ID_RE.test(editMatch[1])) {
    const t = new URLSearchParams(queryPart).get('t');
    if (t) return { kind: 'editor', id: editMatch[1], token: t };
    return { kind: 'viewer', id: editMatch[1] };
  }

  const viewMatch = pathPart.match(/^m\/([^/]+)\/?$/);
  if (viewMatch && ID_RE.test(viewMatch[1])) {
    return { kind: 'viewer', id: viewMatch[1] };
  }

  return { kind: 'template' };
}

/** Build a full pathname for a viewer URL, base-path aware. */
export function viewerPath(id: string): string {
  return `${BASE_PATH}#/m/${id}`;
}

/** Build a full pathname for an editor URL, base-path aware. */
export function editorPath(id: string, token: string): string {
  return `${BASE_PATH}#/m/${id}/edit?t=${token}`;
}
