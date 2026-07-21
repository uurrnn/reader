import { describe, expect, it } from "vitest";
import {
  familyToken,
  isValidFamilyToken,
  isValidParentToken,
  parentToken,
} from "@/lib/auth";

describe("auth tokens", () => {
  it("family token round-trips against the same password", async () => {
    const token = await familyToken("hunter2");
    expect(await isValidFamilyToken(token, "hunter2")).toBe(true);
  });

  it("family token fails against a different password", async () => {
    const token = await familyToken("hunter2");
    expect(await isValidFamilyToken(token, "other")).toBe(false);
  });

  it("rejects undefined and tampered tokens", async () => {
    expect(await isValidFamilyToken(undefined, "hunter2")).toBe(false);
    const token = await familyToken("hunter2");
    expect(await isValidFamilyToken(token + "0", "hunter2")).toBe(false);
  });

  it("family and parent tokens differ for the same secret", async () => {
    expect(await familyToken("1234")).not.toBe(await parentToken("1234"));
  });

  it("parent token round-trips", async () => {
    const token = await parentToken("1234");
    expect(await isValidParentToken(token, "1234")).toBe(true);
    expect(await isValidParentToken(token, "9999")).toBe(false);
  });
});
