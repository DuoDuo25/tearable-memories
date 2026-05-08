/**
 * Database Relations
 *
 * Drizzle ORM relations for typed joins/nested-query shapes.
 * Pure metadata — does not affect migration SQL.
 */

import { relations } from "drizzle-orm";
import { albums, photos } from "./db_schema";

export const albumsRelations = relations(albums, ({ many }) => ({
  photos: many(photos),
}));

export const photosRelations = relations(photos, ({ one }) => ({
  album: one(albums, {
    fields: [photos.album_id],
    references: [albums.id],
  }),
}));
