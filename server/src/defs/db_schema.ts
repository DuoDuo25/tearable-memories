/**
 * Database Schema — Tearable Memories
 *
 * Two tables:
 *   - albums : one row per published memory album. Holds the public id
 *     (8-char nanoid) used in /m/:id URLs, the unguessable edit_token
 *     (32-char nanoid) used for the edit URL, and the ending-layer text.
 *   - photos : one row per photo within an album. Stores S3 URI (never
 *     the client-facing URL) plus the two-line caption.
 *
 * After making changes, run:
 *   edgespark db generate   (create migration files)
 *   edgespark db migrate    (apply to the project database)
 */

import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const albums = sqliteTable("albums", {
  id: text("id").primaryKey(),                          // 8-char public nanoid
  edit_token: text("edit_token").notNull(),             // 32-char private nanoid
  ending_title: text("ending_title").notNull().default(""),
  ending_sub: text("ending_sub").notNull().default(""),
  cta_label: text("cta_label").notNull().default("做同款 →"),
  status: text("status").notNull().default("draft"),    // 'draft' | 'ready'
  created_at: text("created_at").notNull().default(sql`(current_timestamp)`),
  updated_at: text("updated_at").notNull().default(sql`(current_timestamp)`),
});

export const photos = sqliteTable("photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  album_id: text("album_id").notNull(),                 // FK -> albums.id
  position: integer("position").notNull(),              // 0..4
  s3_uri: text("s3_uri").notNull(),                     // s3://albums/<album_id>/<position>.jpg
  title: text("title").notNull().default(""),           // line 1 of caption
  subtitle: text("subtitle").notNull().default(""),     // line 2 of caption
});
