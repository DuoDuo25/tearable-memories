/**
 * Tiny URL parser. Three intents:
 *
 *   /                    → template (Aini's bundled photos)
 *   /m/<id>              → viewer (read-only, public album)
 *   /m/<id>/edit?t=<tok> → editor (caption-edit, token-gated)
 *
 * No history.pushState anywhere yet — the only navigation that happens
 * after load is the success card's <a href>, which is a real navigation.
 */

export type RouteIntent =
  | { kind: 'template' }
  | { kind: 'viewer'; id: string }
  | { kind: 'editor'; id: string; token: string };

const ID_RE = /^[A-Za-z0-9_-]{4,}$/;

export function parseRoute(): RouteIntent {
  const path = window.location.pathname;

  const editMatch = path.match(/^\/m\/([^/]+)\/edit\/?$/);
  if (editMatch && ID_RE.test(editMatch[1])) {
    const t = new URLSearchParams(window.location.search).get('t');
    if (t) return { kind: 'editor', id: editMatch[1], token: t };
    // Missing token → fall through to viewer (still shareable, just not editable).
    return { kind: 'viewer', id: editMatch[1] };
  }

  const viewMatch = path.match(/^\/m\/([^/]+)\/?$/);
  if (viewMatch && ID_RE.test(viewMatch[1])) {
    return { kind: 'viewer', id: viewMatch[1] };
  }

  return { kind: 'template' };
}
