import type { LineupEntry } from "@/lib/audio/logic";

export const TONIGHT_NAME = "tonight";
export const TONIGHT_MAX_ITEMS = 6;

export function toLineupEntry(
  track: {
    id: number;
    title: string;
    kind: "story" | "song" | "ambient";
    audioUrl: string;
    artworkUrl: string | null;
    durationSec: number | null;
  },
  loopCount: number | null,
): LineupEntry {
  return {
    trackId: track.id,
    title: track.title,
    kind: track.kind,
    audioUrl: track.audioUrl,
    artworkUrl: track.artworkUrl,
    durationSec: track.durationSec,
    loopCount,
  };
}
