/**
 * Stat-card branch address — shadowed-handler guard.
 *
 * Two routers both register GET /api/employees/:id/stat-card:
 *
 *   app.ts:355  employeeSecureRouter  -> "/:id([0-9a-fA-F-]{36})/stat-card"
 *   app.ts:359  employeeRouter        -> "/:id/stat-card"
 *
 * Employee ids are CHAR(36) UUIDs, so the secure router's pattern matches every
 * real request and it is mounted first — employeeRouter's copy never runs. That
 * shadowing is invisible when reading either file on its own, and it has already
 * cost one release: commit 03fa454c ("fix(stat-card): show full address on ID
 * card", 2026-07-26) added branch_address/city/state/hr_contact to employeeRouter
 * only, so the digital ID card kept printing just the branch name for five days.
 *
 * The first test pins the Express behaviour that makes this happen. The second
 * pins the columns on the handler that actually serves the request, so editing
 * only the shadowed copy fails here instead of in production.
 */
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECURE_ROUTES = join(backendRoot, "src/modules/employees/employee.secure.routes.ts");

describe("stat-card route shadowing", () => {
  it("the UUID-scoped route mounted first wins, so the later generic route never runs", async () => {
    const secure = express.Router();
    secure.get("/:id([0-9a-fA-F-]{36})/stat-card", (_req, res) =>
      res.json({ servedBy: "secure" }),
    );

    const generic = express.Router();
    generic.get("/:id/stat-card", (_req, res) => res.json({ servedBy: "generic" }));

    const app = express()
      .use("/api/employees", secure)   // app.ts:355
      .use("/api/employees", generic); // app.ts:359

    const uuid = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    const res = await request(app).get(`/api/employees/${uuid}/stat-card`);

    // A real employee id is served by the secure router — the generic one is dead code here.
    expect(res.body.servedBy).toBe("secure");
  });
});

describe("employee.secure.routes.ts stat-card query", () => {
  const source = readFileSync(SECURE_ROUTES, "utf8");

  /** The SQL of the stat-card handler that actually serves UUID requests. */
  const statCardSql = (() => {
    const start = source.indexOf("`${UUID_ROUTE}/stat-card`");
    expect(start, "stat-card route not found in employee.secure.routes.ts").toBeGreaterThan(-1);
    const from = source.indexOf("FROM employees e", start);
    const selectStart = source.lastIndexOf("SELECT", from);
    return source.slice(selectStart, from);
  })();

  it("joins branch_master", () => {
    expect(source.slice(source.indexOf("`${UUID_ROUTE}/stat-card`"))).toContain(
      "LEFT JOIN branch_master b ON b.id = e.branch_id",
    );
  });

  // The digital ID card's back face reads these four aliases. Without them the
  // card silently falls back to the branch name.
  it.each([
    ["branch_address", /COALESCE\(b\.address,\s*''\)\s+AS branch_address/],
    ["branch_city", /b\.city\s+AS branch_city/],
    ["branch_state", /b\.state\s+AS branch_state/],
    ["branch_hr_contact", /COALESCE\(b\.hr_contact,\s*''\)\s+AS branch_hr_contact/],
  ])("selects %s from branch_master", (_alias, pattern) => {
    expect(statCardSql).toMatch(pattern);
  });

  it("keeps the employee's own city/state distinct from the branch's", () => {
    // e.city/e.state are the employee's home address and are selected unaliased.
    // Aliasing either to branch_city/branch_state would put the employee's home
    // town on the ID card instead of the office address.
    expect(statCardSql).toMatch(/e\.city,\s*e\.state/);
    expect(statCardSql).not.toMatch(/e\.city\s+AS branch_city/);
    expect(statCardSql).not.toMatch(/e\.state\s+AS branch_state/);
  });
});
