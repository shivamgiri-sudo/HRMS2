import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

/**
 * /config is the client's "is MCNmeet on?" probe. With the module disabled it must
 * answer 200 { enabled: false } (not 404) so pages render a disabled state without a
 * failing request; every other route keeps the 404 feature guard.
 */
const env = vi.hoisted(() => ({ MCNMEET_ENABLED: false, MCNMEET_BASE_URL: null as string | null }));
vi.mock("../../../config/env.js", () => ({ env }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [[], []]) } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1", role: "hr" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../mcnmeet.service.js", () => ({
  listMyMeetings: vi.fn(async () => ({ meetings: [], total: 0 })),
  generateRoomName: () => "r", buildJoinUrl: () => "u",
}));

const { mcnmeetRouter } = await import("../mcnmeet.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/mcnmeet", mcnmeetRouter); return a; };

describe("mcnmeet /config when the module is disabled", () => {
  it("answers 200 enabled:false with nothing creatable", async () => {
    env.MCNMEET_ENABLED = false;
    const res = await request(app()).get("/api/mcnmeet/config");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, enabled: false, can_create: false, allowed_meeting_types: [] });
  });

  it("still 404s the meeting routes", async () => {
    env.MCNMEET_ENABLED = false;
    expect((await request(app()).get("/api/mcnmeet/my-meetings?status=scheduled")).status).toBe(404);
  });

  it("reports enabled:true and the caller's creatable types when on", async () => {
    env.MCNMEET_ENABLED = true;
    const res = await request(app()).get("/api/mcnmeet/config");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.can_create).toBe(true);
  });
});
