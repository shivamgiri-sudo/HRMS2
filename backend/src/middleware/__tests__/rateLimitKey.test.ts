import { describe, expect, it, vi } from "vitest";

const verify = vi.fn();
vi.mock("../../modules/auth/auth.service.js", () => ({ authService: { verifyAccessToken: (t: string) => verify(t) } }));

import express from "express";
import request from "supertest";
import rateLimit from "express-rate-limit";
import { rateLimitKey } from "../rateLimiter.js";

const req = (auth?: string, ip = "203.0.113.7") => ({ headers: auth ? { authorization: auth } : {}, ip } as never);

describe("rateLimitKey — one bucket per signed-in user, not per office IP", () => {
  it("keys a verified token by its user", () => {
    verify.mockReturnValueOnce({ id: "u-1", email: "a@x" });
    expect(rateLimitKey(req("Bearer good"))).toBe("user:u-1");
  });

  it("falls back to the IP for a forged/expired token, so tokens cannot mint buckets", () => {
    verify.mockReturnValueOnce(null);
    expect(rateLimitKey(req("Bearer forged"))).toBe("ip:203.0.113.7");
  });

  it("uses the IP for anonymous requests and never verifies a mock token", () => {
    verify.mockClear();
    expect(rateLimitKey(req())).toBe("ip:203.0.113.7");
    expect(rateLimitKey(req("Bearer mock-token-admin"))).toBe("ip:203.0.113.7");
    expect(verify).not.toHaveBeenCalled();
  });

  it("two colleagues behind one NAT no longer exhaust each other's limit", async () => {
    verify.mockImplementation((t: string) => ({ id: t, email: "" }));
    const app = express();
    app.set("trust proxy", 1);
    app.use(rateLimit({ windowMs: 60_000, max: 2, keyGenerator: rateLimitKey, standardHeaders: true, legacyHeaders: false }));
    app.get("/x", (_q, r) => r.json({ ok: true }));
    const hit = (who: string) => request(app).get("/x").set("Authorization", `Bearer ${who}`).set("X-Forwarded-For", "198.51.100.9");
    expect((await hit("alice")).status).toBe(200);
    expect((await hit("alice")).status).toBe(200);
    expect((await hit("alice")).status).toBe(429); // alice's own limit
    expect((await hit("bob")).status).toBe(200);   // same office IP, own bucket
  });
});
