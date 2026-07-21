export type ScheduleInput = {
  enabled: boolean;
  startTime: string;
  fadeSeconds: number;
  hardStopTime: string | null;
  ambientTrackId: number | null;
  tonightLoop: boolean;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseScheduleForm(form: {
  get(name: string): unknown;
}): ScheduleInput | null {
  const str = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const startTime = str("startTime");
  if (!TIME_RE.test(startTime)) return null;
  const fadeSeconds = Number(str("fadeSeconds"));
  if (!Number.isInteger(fadeSeconds) || fadeSeconds < 0 || fadeSeconds > 300) {
    return null;
  }
  const hardStopRaw = str("hardStopTime");
  if (hardStopRaw && !TIME_RE.test(hardStopRaw)) return null;
  const ambientRaw = str("ambientTrackId");
  const ambientTrackId = ambientRaw ? Number(ambientRaw) : null;
  if (ambientTrackId !== null && !Number.isInteger(ambientTrackId)) return null;
  return {
    enabled: str("enabled") === "on",
    startTime,
    fadeSeconds,
    hardStopTime: hardStopRaw || null,
    ambientTrackId,
    tonightLoop: str("tonightLoop") === "on",
  };
}
