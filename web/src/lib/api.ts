/**
 * Tearable Memories album API client. Mirrors the four endpoints in
 * server/src/routes/albums.ts.
 */

export interface PhotoMeta {
  title: string;
  subtitle: string;
  contentType: string;
  bytes: number;
}

export interface CreateAlbumBody {
  photos: PhotoMeta[];
  ending_title?: string;
  ending_sub?: string;
  cta_label?: string;
}

export interface UploadSlot {
  position: number;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  s3Uri: string;
}

export interface CreateAlbumResponse {
  id: string;
  edit_token: string;
  uploads: UploadSlot[];
}

export interface ReadAlbumResponse {
  id: string;
  photos: Array<{ position: number; url: string; title: string; subtitle: string }>;
  ending_title: string;
  ending_sub: string;
  cta_label: string;
  created_at: string;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* fall through */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function createAlbum(body: CreateAlbumBody): Promise<CreateAlbumResponse> {
  return jsonFetch<CreateAlbumResponse>('/api/public/albums', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Upload a single blob to its presigned PUT URL. */
export async function uploadToPresigned(slot: UploadSlot, blob: Blob): Promise<void> {
  const res = await fetch(slot.uploadUrl, {
    method: 'PUT',
    headers: slot.requiredHeaders,
    body: blob,
  });
  if (!res.ok) throw new Error(`upload position ${slot.position}: HTTP ${res.status}`);
}

export function finalizeAlbum(id: string, editToken: string): Promise<{ ok: true; id: string; status: string }> {
  return jsonFetch(`/api/public/albums/${id}/finalize`, {
    method: 'POST',
    headers: { 'x-edit-token': editToken },
  });
}

export function readAlbum(id: string): Promise<ReadAlbumResponse> {
  return jsonFetch<ReadAlbumResponse>(`/api/public/albums/${id}`);
}

export interface UpdateAlbumBody {
  photos: Array<{ title: string; subtitle: string }>;
  ending_title?: string;
  ending_sub?: string;
  cta_label?: string;
}

/** Token-gated caption / ending update. Photos themselves are not replaced. */
export function updateAlbum(id: string, editToken: string, body: UpdateAlbumBody): Promise<{ ok: true; id: string }> {
  return jsonFetch(`/api/public/albums/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-edit-token': editToken },
    body: JSON.stringify(body),
  });
}
