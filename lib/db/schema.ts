import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const trackKind = pgEnum("track_kind", ["story", "song", "ambient"]);

export const tracks = pgTable("tracks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  kind: trackKind("kind").notNull().default("story"),
  audioUrl: text("audio_url").notNull(),
  artworkUrl: text("artwork_url"),
  durationSec: real("duration_sec"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const playlists = pgTable(
  "playlists",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    loop: boolean("loop").notNull().default(false),
  },
  (table) => [uniqueIndex("playlists_name_unique").on(table.name)],
);

export const playlistItems = pgTable("playlist_items", {
  id: serial("id").primaryKey(),
  playlistId: integer("playlist_id")
    .notNull()
    .references(() => playlists.id, { onDelete: "cascade" }),
  trackId: integer("track_id")
    .notNull()
    .references(() => tracks.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull(),
  loopCount: integer("loop_count"),
});

export const schedule = pgTable("schedule", {
  id: integer("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  startTime: text("start_time").notNull().default("20:30"),
  fadeSeconds: integer("fade_seconds").notNull().default(30),
  hardStopTime: text("hard_stop_time"),
  ambientTrackId: integer("ambient_track_id").references(() => tracks.id, {
    onDelete: "set null",
  }),
});

export const playbackState = pgTable("playback_state", {
  trackId: integer("track_id")
    .primaryKey()
    .references(() => tracks.id, { onDelete: "cascade" }),
  positionSec: real("position_sec").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
