import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
// Mock the supabaseAdmin module before importing the middleware
vi.mock("../src/db/supabaseAdmin.js", () => ({
    supabaseAdmin: {},
    supabaseAuthClient: {
        auth: {
            getUser: vi.fn(),
        },
    },
}));
import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";
import { requireAuth } from "../src/middleware/authMiddleware.js";
const mockGetUser = supabaseAuthClient.auth.getUser;
function buildApp() {
    const app = express();
    app.use(express.json());
    app.get("/protected", requireAuth, (req, res) => {
        res.json({ success: true, userId: req.authUser?.id });
    });
    return app;
}
describe("requireAuth middleware", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    it("returns 401 when Authorization header is missing", async () => {
        const res = await request(buildApp()).get("/protected");
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toMatch(/Missing authorization token/i);
    });
    it("returns 401 when Authorization header does not start with Bearer", async () => {
        const res = await request(buildApp())
            .get("/protected")
            .set("Authorization", "Basic sometoken");
        expect(res.status).toBe(401);
        expect(res.body.message).toMatch(/Missing authorization token/i);
    });
    it("returns 401 when Supabase returns an error", async () => {
        mockGetUser.mockResolvedValueOnce({
            data: { user: null },
            error: { message: "JWT expired" },
        });
        const res = await request(buildApp())
            .get("/protected")
            .set("Authorization", "Bearer bad.token.here");
        expect(res.status).toBe(401);
        expect(res.body.message).toMatch(/Invalid or expired token/i);
    });
    it("returns 401 when Supabase returns no user", async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
        const res = await request(buildApp())
            .get("/protected")
            .set("Authorization", "Bearer sometoken");
        expect(res.status).toBe(401);
    });
    it("attaches authUser and calls next when token is valid", async () => {
        mockGetUser.mockResolvedValueOnce({
            data: { user: { id: "user-123", email: "admin@mcn.com" } },
            error: null,
        });
        const res = await request(buildApp())
            .get("/protected")
            .set("Authorization", "Bearer valid.token");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.userId).toBe("user-123");
    });
});
