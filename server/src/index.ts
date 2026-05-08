/**
 * Tearable Memories — server entry
 *
 * Path conventions (per EdgeSpark):
 *   /api/*         → login required
 *   /api/public/*  → optional auth (we live here — anonymous app)
 *   /api/webhooks/* → no auth check
 */

import { Hono } from 'hono';
import { albumsRoutes } from './routes/albums';

const app = new Hono()
  .get('/api/public/health', (c) =>
    c.json({ ok: true, service: 'tearable-memories', phase: 3 })
  );

app.route('/api/public/albums', albumsRoutes);

export default app;
