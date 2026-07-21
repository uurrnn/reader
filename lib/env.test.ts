import { describe, expect, it } from "vitest";
import { requiredEnv } from "@/lib/env";

describe("requiredEnv", () => {
  it("returns the value when set", () => {
    process.env.TEST_REQUIRED_ENV = "abc";
    expect(requiredEnv("TEST_REQUIRED_ENV")).toBe("abc");
  });

  it("throws a descriptive error when missing", () => {
    delete process.env.TEST_MISSING_ENV;
    expect(() => requiredEnv("TEST_MISSING_ENV")).toThrow(
      "Missing required env var: TEST_MISSING_ENV",
    );
  });

  it("throws when the value is an empty string", () => {
    process.env.TEST_EMPTY_ENV = "";
    expect(() => requiredEnv("TEST_EMPTY_ENV")).toThrow("TEST_EMPTY_ENV");
  });
});
