"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { playbackState, playlistItems, tracks } from "@/lib/db/schema";
import { getOrCreateTonight, TONIGHT_MAX_ITEMS } from "@/lib/playlists";

export async function addToTonight(trackId: number): Promise<void> {
  const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId));
  if (!track || track.kind === "ambient") return;
  const tonight = await getOrCreateTonight();
  const [{ count, maxSort }] = await db
    .select({
      count: sql<number>`count(*)::int`,
      maxSort: sql<number>`coalesce(max(${playlistItems.sortOrder}), 0)::int`,
    })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, tonight.id));
  if (count >= TONIGHT_MAX_ITEMS) return;
  await db.insert(playlistItems).values({
    playlistId: tonight.id,
    trackId,
    sortOrder: maxSort + 1,
  });
  revalidatePath("/");
}

export async function removeTonightItem(itemId: number): Promise<void> {
  const tonight = await getOrCreateTonight();
  await db
    .delete(playlistItems)
    .where(
      and(eq(playlistItems.id, itemId), eq(playlistItems.playlistId, tonight.id)),
    );
  revalidatePath("/");
}

export async function clearTonight(): Promise<void> {
  const tonight = await getOrCreateTonight();
  await db.delete(playlistItems).where(eq(playlistItems.playlistId, tonight.id));
  revalidatePath("/");
}

export async function saveResume(trackId: number, positionSec: number): Promise<void> {
  if (!Number.isFinite(positionSec) || positionSec < 0) return;
  await db
    .insert(playbackState)
    .values({ trackId, positionSec, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: playbackState.trackId,
      set: { positionSec, updatedAt: new Date() },
    });
}

export async function clearResume(trackId: number): Promise<void> {
  await db.delete(playbackState).where(eq(playbackState.trackId, trackId));
}
