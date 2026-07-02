import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: {
    auth: {
      getUser: vi.fn(),
    },
  },
}));
vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([[], []]),
    executeRun: vi.fn(),
    getConnection: vi.fn().mockResolvedValue([[], []]),
  },
  pingDb: vi.fn(),
}));

import { db } from "../src/db/mysql.js";
import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";
import { app } from "../src/app.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockGetUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;

describe("engagement routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    const response = await request(app).get("/api/engagement/badges");
    expect(response.status).toBe(401);
  });

  it("returns active badges for the gallery", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "employee@example.com" } },
      error: null,
    });
    mockExecute.mockResolvedValueOnce([[
      {
        badge_id: "badge-1",
        badge_name: "Early Bird",
        badge_description: "Logged in early",
        badge_icon: null,
        badge_category: "activity",
        points_value: 50,
        criteria_json: null,
        is_active: 1,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ], []]);

    const response = await request(app)
      .get("/api/engagement/badges")
      .set({ Authorization: "Bearer mock-token-admin" });

    expect(response.status).toBe(200);
    expect(response.body.data[0].badge_name).toBe("Early Bird");
    expect(mockExecute.mock.calls[0][0]).toContain("FROM gamification_badge_master");
  });
});
