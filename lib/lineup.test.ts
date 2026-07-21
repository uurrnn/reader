import { describe, expect, it } from "vitest";
import { toLineupEntry, TONIGHT_MAX_ITEMS, TONIGHT_NAME } from "@/lib/lineup";

describe("lineup consts", () => {
  it("exposes the reserved playlist name and cap", () => {
    expect(TONIGHT_NAME).toBe("tonight");
    expect(TONIGHT_MAX_ITEMS).toBe(6);
  });
});

describe("toLineupEntry", () => {
  const track = {
    id: 7,
    title: "The Gruffalo",
    kind: "story" as const,
    audioUrl: "https://x.public.blob.vercel-storage.com/a.mp3",
    artworkUrl: null,
    durationSec: 754,
  };

  it("maps a track row plus loop count into a LineupEntry", () => {
    expect(toLineupEntry(track, 2)).toEqual({
      trackId: 7,
      title: "The Gruffalo",
      kind: "story",
      audioUrl: "https://x.public.blob.vercel-storage.com/a.mp3",
      artworkUrl: null,
      durationSec: 754,
      loopCount: 2,
    });
  });

  it("defaults loopCount to null", () => {
    expect(toLineupEntry(track, null).loopCount).toBeNull();
  });
});
