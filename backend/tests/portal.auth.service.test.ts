import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) } }));

import { portalAuthService } from "../src/modules/portal/portal.auth.service.js";

describe("portalAuthService.generateOtp", () => {
  it("returns a 6-digit numeric string", () => {
    const otp = portalAuthService.generateOtp();
    expect(otp).toMatch(/^\d{6}$/);
  });
});

describe("portalAuthService.issueToken", () => {
  it("returns a string token containing 3 JWT segments", () => {
    const token = portalAuthService.issueToken({
      clientUserId: "u-1",
      clientId: "c-1",
      processIds: ["p-1"],
    });
    expect(token.split(".")).toHaveLength(3);
  });
});

describe("portalAuthService.verifyToken", () => {
  it("round-trips a valid token", () => {
    const payload = { clientUserId: "u-1", clientId: "c-1", processIds: ["p-1"] };
    const token = portalAuthService.issueToken(payload);
    const decoded = portalAuthService.verifyToken(token);
    expect(decoded.clientUserId).toBe("u-1");
    expect(decoded.processIds).toEqual(["p-1"]);
  });

  it("throws on invalid token", () => {
    expect(() => portalAuthService.verifyToken("bad.token.here")).toThrow();
  });
});
