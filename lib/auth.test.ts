import { describe, expect, it } from "vitest";
import { isValidParentToken, parentToken } from "@/lib/auth";

describe("auth tokens", () => {
  describe("parent tokens (expiring)", () => {
    const EXPIRES = 1_800_000_000; // fixed epoch seconds for determinism

    it("round-trips before expiry", async () => {
      const token = await parentToken("1234", EXPIRES);
      expect(await isValidParentToken(token, "1234", EXPIRES - 10)).toBe(true);
    });

    it("rejects at and after expiry", async () => {
      const token = await parentToken("1234", EXPIRES);
      expect(await isValidParentToken(token, "1234", EXPIRES)).toBe(false);
      expect(await isValidParentToken(token, "1234", EXPIRES + 1)).toBe(false);
    });

    it("rejects a tampered expiry timestamp", async () => {
      const token = await parentToken("1234", EXPIRES);
      const [, mac] = token.split(".");
      const forged = `${EXPIRES + 9999}.${mac}`;
      expect(await isValidParentToken(forged, "1234", EXPIRES - 10)).toBe(false);
    });

    it("rejects the wrong pin", async () => {
      const token = await parentToken("1234", EXPIRES);
      expect(await isValidParentToken(token, "9999", EXPIRES - 10)).toBe(false);
    });

    it("rejects undefined and malformed tokens", async () => {
      expect(await isValidParentToken(undefined, "1234", EXPIRES - 10)).toBe(false);
      expect(await isValidParentToken("no-dot-here", "1234", EXPIRES - 10)).toBe(false);
      expect(await isValidParentToken(".abc", "1234", EXPIRES - 10)).toBe(false);
    });
  });
});
