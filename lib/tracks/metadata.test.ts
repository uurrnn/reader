import { describe, expect, it } from "vitest";
import { titleFromFilename, toTrackMeta } from "@/lib/tracks/metadata";

describe("titleFromFilename", () => {
  it("strips extension and normalizes separators", () => {
    expect(titleFromFilename("the_gruffalo-part1.mp3")).toBe("the gruffalo part1");
  });

  it("collapses repeated whitespace", () => {
    expect(titleFromFilename("Goodnight   Moon .m4a")).toBe("Goodnight Moon");
  });
});

describe("toTrackMeta", () => {
  it("prefers the tag title over the filename", () => {
    const meta = { common: { title: "The Gruffalo" }, format: { duration: 754.3 } };
    const result = toTrackMeta(meta, "track01.mp3");
    expect(result.title).toBe("The Gruffalo");
    expect(result.durationSec).toBe(754);
  });

  it("falls back to a cleaned filename when there is no tag title", () => {
    const result = toTrackMeta({ common: {}, format: {} }, "rain_sounds.mp3");
    expect(result.title).toBe("rain sounds");
    expect(result.durationSec).toBeNull();
  });

  it("handles null metadata (parse failure)", () => {
    const result = toTrackMeta(null, "story.mp3");
    expect(result).toEqual({ title: "story", durationSec: null, picture: null });
  });

  it("ignores a blank tag title", () => {
    const result = toTrackMeta({ common: { title: "  " }, format: {} }, "owl.mp3");
    expect(result.title).toBe("owl");
  });

  it("passes through the first embedded picture", () => {
    const data = new Uint8Array([1, 2, 3]);
    const meta = {
      common: { picture: [{ data, format: "image/jpeg" }] },
      format: {},
    };
    const result = toTrackMeta(meta, "x.mp3");
    expect(result.picture).toEqual({ data, mime: "image/jpeg" });
  });
});
