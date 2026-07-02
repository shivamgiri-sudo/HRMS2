import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { z } from "zod";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler.js";
function buildApp(handler, isError = false) {
    const app = express();
    app.use(express.json());
    if (isError) {
        app.get("/test", (_req, _res, next) => next(handler));
        app.use(errorHandler);
    }
    else {
        app.use(handler);
    }
    return app;
}
describe("notFoundHandler", () => {
    it("returns 404 with route info for unknown GET", async () => {
        const app = express();
        app.use(notFoundHandler);
        const res = await request(app).get("/no-such-route");
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toMatch(/GET.*\/no-such-route/);
    });
    it("includes method in the message for POST", async () => {
        const app = express();
        app.use(notFoundHandler);
        const res = await request(app).post("/missing");
        expect(res.status).toBe(404);
        expect(res.body.message).toMatch(/POST/);
    });
});
describe("errorHandler", () => {
    it("returns 400 with field errors for ZodError", async () => {
        const app = express();
        app.get("/test", (_req, _res, next) => {
            try {
                z.object({ name: z.string().min(1) }).parse({});
            }
            catch (e) {
                next(e);
            }
        });
        app.use(errorHandler);
        const res = await request(app).get("/test");
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe("Validation failed");
        expect(res.body.errors).toBeDefined();
    });
    it("returns 500 with message for generic Error", async () => {
        const app = express();
        app.get("/test", (_req, _res, next) => next(new Error("something broke")));
        app.use(errorHandler);
        const res = await request(app).get("/test");
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe("something broke");
    });
    it("returns 500 with generic message for non-Error thrown value", async () => {
        const app = express();
        app.get("/test", (_req, _res, next) => next("string error"));
        app.use(errorHandler);
        const res = await request(app).get("/test");
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe("Unexpected server error");
    });
});
