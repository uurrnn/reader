import { describe, expect, it } from "vitest";
import { parseScheduleForm } from "@/lib/schedule";

function form(entries: Record<string, string>) {
  return { get: (name: string) => entries[name] ?? null };
}

describe("parseScheduleForm", () => {
  it("parses a full valid form", () => {
    expect(
      parseScheduleForm(
        form({
          enabled: "on",
          startTime: "20:30",
          fadeSeconds: "45",
          hardStopTime: "21:15",
          ambientTrackId: "3",
          tonightLoop: "on",
        }),
      ),
    ).toEqual({
      enabled: true,
      startTime: "20:30",
      fadeSeconds: 45,
      hardStopTime: "21:15",
      ambientTrackId: 3,
      tonightLoop: true,
    });
  });

  it("treats missing checkboxes and empty optionals as off/null", () => {
    expect(
      parseScheduleForm(
        form({ startTime: "19:05", fadeSeconds: "30", hardStopTime: "", ambientTrackId: "" }),
      ),
    ).toEqual({
      enabled: false,
      startTime: "19:05",
      fadeSeconds: 30,
      hardStopTime: null,
      ambientTrackId: null,
      tonightLoop: false,
    });
  });

  it("rejects malformed times", () => {
    expect(parseScheduleForm(form({ startTime: "25:00", fadeSeconds: "30" }))).toBeNull();
    expect(parseScheduleForm(form({ startTime: "8pm", fadeSeconds: "30" }))).toBeNull();
    expect(
      parseScheduleForm(form({ startTime: "20:30", fadeSeconds: "30", hardStopTime: "9:5" })),
    ).toBeNull();
  });

  it("rejects out-of-range or non-integer fade seconds", () => {
    expect(parseScheduleForm(form({ startTime: "20:30", fadeSeconds: "-1" }))).toBeNull();
    expect(parseScheduleForm(form({ startTime: "20:30", fadeSeconds: "301" }))).toBeNull();
    expect(parseScheduleForm(form({ startTime: "20:30", fadeSeconds: "abc" }))).toBeNull();
  });
});
