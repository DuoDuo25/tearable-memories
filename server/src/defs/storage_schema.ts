/**
 * Storage Schema — Tearable Memories
 *
 * One bucket: `albums`. Each album's photos live under
 *   albums/<album_id>/<position>.jpg
 *
 * After editing this file, run:
 *   edgespark storage apply
 */

import type { BucketDef } from "@sdk/server-types";

export const albums: BucketDef<"albums"> = {
  bucket_name: "albums",
  description: "User-uploaded photos for tearable memory albums (one folder per album)",
};
