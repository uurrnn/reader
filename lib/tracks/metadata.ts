export type AudioMetaLike = {
  common: {
    title?: string;
    picture?: { data: Uint8Array; format: string }[];
  };
  format: { duration?: number };
};

export type ExtractedMeta = {
  title: string;
  durationSec: number | null;
  picture: { data: Uint8Array; mime: string } | null;
};

export function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function toTrackMeta(
  meta: AudioMetaLike | null,
  filename: string,
): ExtractedMeta {
  const tagTitle = meta?.common.title?.trim();
  const picture = meta?.common.picture?.[0];
  const duration = meta?.format.duration;
  return {
    title: tagTitle || titleFromFilename(filename),
    durationSec: duration ? Math.round(duration) : null,
    picture: picture ? { data: picture.data, mime: picture.format } : null,
  };
}
