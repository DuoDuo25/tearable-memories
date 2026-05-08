/**
 * Tearable Memories — server entry
 *
 * Path conventions (per EdgeSpark):
 *   /api/*         → login required
 *   /api/public/*  → optional auth (we live here — anonymous app)
 *   /api/webhooks/* → no auth check
 *
 * Phase 2 only ships /api/public/health. Real album endpoints arrive in
 * Phase 3 (POST/GET/PUT /api/public/albums + presigned uploads).
 */

import { Hono } from "hono";

const app = new Hono()
  .get("/api/public/health", (c) =>
    c.json({ ok: true, service: "tearable-memories", phase: 2 })
  );

export default app;
