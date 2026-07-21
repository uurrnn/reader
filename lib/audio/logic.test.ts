import { describe, expect, it } from "vitest";
import {
  fadeCurve,
  hardStopAlreadyPassed,
  isWithinCatchUp,
  msUntilStart,
  nextPosition,
  resumeStartPosition,
  shouldPersistResume,
} from "@/lib/audio/logic";

const at = (h: number, m: number, s = 0) => new Date(2026, 6, 21, h, m, s);

describe("msUntilStart", () => {
  it("counts down to a start later today", () => {
    expect(msUntilStart(at(20, 0), "20:30")).toBe(30 * 60 * 1000);
  });

  it("rolls to tomorrow when the time has passed", () => {
    expect(msUntilStart(at(21, 0), "20:30")).toBe(23.5 * 60 * 60 * 1000);
  });

  it("rolls to tomorrow at the exact start minute", () => {
    expect(msUntilStart(at(20, 30), "20:30")).toBe(24 * 60 * 60 * 1000);
  });
});

describe("isWithinCatchUp", () => {
  it("is false before the start time", () => {
    expect(isWithinCatchUp(at(20, 0), "20:30")).toBe(false);
  });

  it("is true shortly after the start time", () => {
    expect(isWithinCatchUp(at(20, 45), "20:30")).toBe(true);
  });

  it("is false once the grace window has passed", () => {
    expect(isWithinCatchUp(at(22, 1), "20:30", 90)).toBe(false);
  });

  it("catches up across midnight after a late start", () => {
    expect(isWithinCatchUp(new Date(2026, 6, 22, 0, 15), "23:30", 90)).toBe(true);
  });

  it("is false across midnight once the grace window has passed", () => {
    expect(isWithinCatchUp(new Date(2026, 6, 22, 1, 15), "23:30", 90)).toBe(false);
  });
});

describe("hardStopAlreadyPassed", () => {
  it("is false when the stop is later tonight", () => {
    expect(hardStopAlreadyPassed(at(20, 30), "21:15")).toBe(false);
  });

  it("is false for a past-midnight stop configured tonight", () => {
    expect(hardStopAlreadyPassed(at(20, 30), "01:00")).toBe(false);
  });

  it("is true once the stop time has passed this evening", () => {
    expect(hardStopAlreadyPassed(at(23, 0), "21:15")).toBe(true);
  });

  it("is true after a past-midnight stop has passed", () => {
    expect(hardStopAlreadyPassed(at(1, 30), "01:00")).toBe(true);
  });
});

describe("nextPosition", () => {
  const once = { loopCount: null };
  const twice = { loopCount: 2 };
  const forever = { loopCount: -1 };

  it("advances to the next item after a play-once item", () => {
    expect(nextPosition({ index: 0, loopsDone: 1 }, [once, once], false)).toEqual({
      index: 1,
      loopsDone: 0,
    });
  });

  it("repeats an item until its loop count is used up", () => {
    expect(nextPosition({ index: 0, loopsDone: 1 }, [twice, once], false)).toEqual({
      index: 0,
      loopsDone: 1,
    });
    expect(nextPosition({ index: 0, loopsDone: 2 }, [twice, once], false)).toEqual({
      index: 1,
      loopsDone: 0,
    });
  });

  it("repeats forever on loopCount -1", () => {
    expect(nextPosition({ index: 0, loopsDone: 99 }, [forever], false)).toEqual({
      index: 0,
      loopsDone: 99,
    });
  });

  it("ends after the last item without lineup loop", () => {
    expect(nextPosition({ index: 1, loopsDone: 1 }, [once, once], false)).toBe("end");
  });

  it("wraps to the first item with lineup loop", () => {
    expect(nextPosition({ index: 1, loopsDone: 1 }, [once, once], true)).toEqual({
      index: 0,
      loopsDone: 0,
    });
  });
});

describe("fadeCurve", () => {
  it("starts and ends at the endpoints", () => {
    const curve = fadeCurve(0, 1);
    expect(curve[0]).toBeCloseTo(0, 5);
    expect(curve[curve.length - 1]).toBeCloseTo(1, 5);
  });

  it("is monotonic downward for a fade-out", () => {
    const curve = fadeCurve(1, 0, 32);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]).toBeLessThanOrEqual(curve[i - 1]);
    }
  });
});

describe("shouldPersistResume", () => {
  it("persists only long stories", () => {
    expect(shouldPersistResume("story", 1200)).toBe(true);
    expect(shouldPersistResume("story", 300)).toBe(false);
    expect(shouldPersistResume("story", null)).toBe(false);
    expect(shouldPersistResume("song", 1200)).toBe(false);
  });
});

describe("resumeStartPosition", () => {
  it("resumes mid-story", () => {
    expect(resumeStartPosition(500, 1200)).toBe(500);
  });

  it("restarts when there is no saved position", () => {
    expect(resumeStartPosition(null, 1200)).toBe(0);
    expect(resumeStartPosition(undefined, 1200)).toBe(0);
  });

  it("restarts near the beginning or the end", () => {
    expect(resumeStartPosition(10, 1200)).toBe(0);
    expect(resumeStartPosition(1190, 1200)).toBe(0);
  });

  it("resumes when duration is unknown but position is meaningful", () => {
    expect(resumeStartPosition(500, null)).toBe(500);
  });
});
