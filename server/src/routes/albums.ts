/**
 * Album endpoints — Phase 3.
 *
 *   POST  /api/public/albums           Create album, get presigned PUTs.
 *   POST  /api/public/albums/:id/finalize  HEAD-verify uploads, mark ready.
 *   GET   /api/public/albums/:id       Read public album (presigned GETs).
 *   PUT   /api/public/albums/:id       Edit (token in x-edit-token header).
 *
 * No auth — anonymous app. The 32-char edit_token is the only authority.
 */

import { db, storage } from 'edgespark';
import { eq, and, asc } from 'drizzle-orm';
import { Hono } from 'hono';
import { albums, photos, buckets } from '@defs';
import { newAlbumId, newEditToken } from '../lib/ids';
import { validateAlbumInput, fileExtFor, type AlbumInput, type PhotoInput } from '../lib/validate';

const PRESIGN_PUT_TTL = 60 * 30;       // 30 min
const PRESIGN_GET_TTL = 60 * 60;       // 1 hour
const STATUS_READY = 'ready';
const STATUS_DRAFT = 'draft';

interface UploadSlot {
  position: number;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  s3Uri: string;
}

function s3KeyFor(albumId: string, position: number, contentType?: string) {
  return `${albumId}/${position}.${fileExtFor(contentType)}`;
}

async function presignPut(key: string, contentType?: string) {
  const { uploadUrl, requiredHeaders } = await storage
    .from(buckets.albums)
    .createPresignedPutUrl(key, PRESIGN_PUT_TTL, contentType ? { contentType } : {});
  const s3Uri = storage.createS3Uri(buckets.albums, key);
  return { uploadUrl, requiredHeaders, s3Uri };
}

async function presignGet(s3Uri: string): Promise<string> {
  const parsed = storage.tryParseS3Uri(s3Uri);
  if (!parsed) throw new Error('Stored s3_uri is malformed: ' + s3Uri);
  const { downloadUrl } = await storage
    .from(parsed.bucket)
    .createPresignedGetUrl(parsed.path, PRESIGN_GET_TTL);
  return downloadUrl;
}

export const albumsRoutes = new Hono()
  // ---------- POST /api/public/albums  (create) ----------
  .post('/', async (c) => {
    const body = await c.req.json<AlbumInput>().catch(() => null);
    if (!body) return c.json({ error: 'invalid JSON body' }, 400);

    const err = validateAlbumInput(body);
    if (err) return c.json({ error: err.message }, err.status);

    const id = newAlbumId();
    const editToken = newEditToken();

    // Build presigned PUT URLs in parallel.
    const slots: UploadSlot[] = await Promise.all(
      body.photos.map(async (p, i) => {
        const key = s3KeyFor(id, i, p.contentType);
        const { uploadUrl, requiredHeaders, s3Uri } = await presignPut(key, p.contentType);
        return { position: i, uploadUrl, requiredHeaders, s3Uri };
      })
    );

    // Atomic write of album + photo rows.
    await db.batch([
      db.insert(albums).values({
        id,
        edit_token: editToken,
        ending_title: body.ending_title ?? '',
        ending_sub: body.ending_sub ?? '',
        cta_label: body.cta_label ?? '做同款 →',
        status: STATUS_DRAFT,
      }),
      ...body.photos.map((p, i) =>
        db.insert(photos).values({
          album_id: id,
          position: i,
          s3_uri: slots[i].s3Uri,
          title: p.title ?? '',
          subtitle: p.subtitle ?? '',
        })
      ),
    ] as never);

    return c.json({
      id,
      edit_token: editToken,
      uploads: slots.map((s) => ({
        position: s.position,
        uploadUrl: s.uploadUrl,
        requiredHeaders: s.requiredHeaders,
        s3Uri: s.s3Uri,
      })),
    }, 201);
  })

  // ---------- POST /api/public/albums/:id/finalize ----------
  .post('/:id/finalize', async (c) => {
    const id = c.req.param('id');
    const token = c.req.header('x-edit-token') ?? '';

    const [album] = await db.select().from(albums).where(eq(albums.id, id));
    if (!album) return c.json({ error: 'album not found' }, 404);
    if (album.edit_token !== token) return c.json({ error: 'invalid edit token' }, 403);

    const rows = await db.select().from(photos).where(eq(photos.album_id, id)).orderBy(asc(photos.position));

    // HEAD each S3 object to confirm the client actually completed its PUTs.
    for (const r of rows) {
      const parsed = storage.tryParseS3Uri(r.s3_uri);
      if (!parsed) return c.json({ error: 'corrupt s3_uri at position ' + r.position }, 500);
      const meta = await storage.from(parsed.bucket).head(parsed.path);
      if (!meta) {
        return c.json({ error: 'photo at position ' + r.position + ' has not been uploaded yet' }, 409);
      }
    }

    await db.update(albums)
      .set({ status: STATUS_READY, updated_at: new Date().toISOString() })
      .where(eq(albums.id, id));

    return c.json({ ok: true, id, status: STATUS_READY });
  })

  // ---------- GET /api/public/albums/:id  (public read) ----------
  .get('/:id', async (c) => {
    const id = c.req.param('id');
    const [album] = await db.select().from(albums).where(eq(albums.id, id));
    if (!album) return c.json({ error: 'album not found' }, 404);
    if (album.status !== STATUS_READY) {
      return c.json({ error: 'album is not ready yet' }, 404);
    }

    const rows = await db.select().from(photos).where(eq(photos.album_id, id)).orderBy(asc(photos.position));

    const photoUrls = await Promise.all(
      rows.map(async (r) => ({
        position: r.position,
        url: await presignGet(r.s3_uri),
        title: r.title,
        subtitle: r.subtitle,
      }))
    );

    // edit_token is NEVER included in this response.
    return c.json({
      id: album.id,
      photos: photoUrls,
      ending_title: album.ending_title,
      ending_sub: album.ending_sub,
      cta_label: album.cta_label,
      created_at: album.created_at,
    });
  })

  // ---------- PUT /api/public/albums/:id  (token-gated edit) ----------
  .put('/:id', async (c) => {
    const id = c.req.param('id');
    const token = c.req.header('x-edit-token') ?? '';

    const [album] = await db.select().from(albums).where(eq(albums.id, id));
    if (!album) return c.json({ error: 'album not found' }, 404);
    if (album.edit_token !== token) return c.json({ error: 'invalid edit token' }, 403);

    const body = await c.req.json<AlbumInput & { replace_photos?: boolean }>().catch(() => null);
    if (!body) return c.json({ error: 'invalid JSON body' }, 400);

    const err = validateAlbumInput(body);
    if (err) return c.json({ error: err.message }, err.status);

    const replace = body.replace_photos === true;

    // If client wants to replace photos, mint new presigned PUTs for the new
    // set, replace the photo rows, and flip status back to draft. Otherwise
    // we only touch the ending fields. Captions can be updated either way.
    if (replace) {
      const slots: UploadSlot[] = await Promise.all(
        body.photos.map(async (p: PhotoInput, i: number) => {
          const key = s3KeyFor(id, i, p.contentType);
          const { uploadUrl, requiredHeaders, s3Uri } = await presignPut(key, p.contentType);
          return { position: i, uploadUrl, requiredHeaders, s3Uri };
        })
      );

      await db.batch([
        db.delete(photos).where(eq(photos.album_id, id)),
        ...body.photos.map((p: PhotoInput, i: number) =>
          db.insert(photos).values({
            album_id: id,
            position: i,
            s3_uri: slots[i].s3Uri,
            title: p.title ?? '',
            subtitle: p.subtitle ?? '',
          })
        ),
        db.update(albums).set({
          ending_title: body.ending_title ?? album.ending_title,
          ending_sub: body.ending_sub ?? album.ending_sub,
          cta_label: body.cta_label ?? album.cta_label,
          status: STATUS_DRAFT,
          updated_at: new Date().toISOString(),
        }).where(eq(albums.id, id)),
      ] as never);

      return c.json({
        id,
        uploads: slots.map((s) => ({
          position: s.position,
          uploadUrl: s.uploadUrl,
          requiredHeaders: s.requiredHeaders,
          s3Uri: s.s3Uri,
        })),
      });
    }

    // Caption-only / endings-only edit.
    const ops = [
      db.update(albums).set({
        ending_title: body.ending_title ?? album.ending_title,
        ending_sub: body.ending_sub ?? album.ending_sub,
        cta_label: body.cta_label ?? album.cta_label,
        updated_at: new Date().toISOString(),
      }).where(eq(albums.id, id)),
      ...body.photos.map((p: PhotoInput, i: number) =>
        db.update(photos)
          .set({ title: p.title ?? '', subtitle: p.subtitle ?? '' })
          .where(and(eq(photos.album_id, id), eq(photos.position, i)))
      ),
    ];
    await db.batch(ops as never);

    return c.json({ ok: true, id });
  });
