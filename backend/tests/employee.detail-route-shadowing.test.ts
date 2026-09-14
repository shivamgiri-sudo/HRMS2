/**
 * GET /api/employees/:id — de-shadowing guard.
 *
 * employee.secure.routes.ts used to also register a plain
 * `router.get(UUID_ROUTE, ...)` returning `SELECT e.*` unredacted. Because that
 * router is mounted before employee.routes.ts (app.ts) and employee ids are
 * UUIDs, it answered every real GET /api/employees/:id request, so the redacted
 * handler in employee.routes.ts (line ~1213 -> employee.controller.ts
 * getEmployee, proven safe by employeeDetailRedaction.contract.test.ts) never
 * actually ran — wfm/manager/branch_head/process_manager/it_head received raw
 * Aadhaar/PAN/bank/UAN on every employee inside their scope.
 *
 * This pins two things so the shadow can't silently come back:
 *  1. employee.secure.routes.ts no longer defines a bare UUID_ROUTE GET handler.
 *  2. With only employee.secure.routes.ts's remaining routes and employee.routes.ts
 *     mounted in the real app.ts order, a plain GET /api/employees/:id request is
 *     served by employee.routes.ts (i.e. actually reaches redaction), not silently
 *     swallowed by the secure router's stat-card/ctc routes or 404'd.
 *
 * Does NOT touch /:id/stat-card or /:id/ctc — those still deliberately shadow
 * employee.routes.ts's copies; see employee.stat-card-branch-address.test.ts and
 * the "SHADOWED" comment at employee.routes.ts:1287.
 */
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECURE_ROUTES = join(backendRoot, "src/modules/employees/employee.secure.routes.ts");

describe("employee.secure.routes.ts no longer defines a plain GET /:id", () => {
  const source = readFileSync(SECURE_ROUTES, "utf8");
  // Strip `//` line comments so the guard below can't be defeated by a NOTE
  // that merely mentions the removed handler's old shape in prose.
  const code = source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\/\/.*/, ""))
    .join("\n");

  it("has no bare `router.get(UUID_ROUTE, ...)` (only /stat-card and /ctc suffixed variants)", () => {
    // Matches `router.get(UUID_ROUTE,` but not `router.get(`${UUID_ROUTE}/...`,`
    expect(code).not.toMatch(/router\.get\(\s*UUID_ROUTE\s*,/);
  });

  it("still defines the intentionally-shadowing /stat-card and /ctc routes", () => {
    expect(source).toContain("`${UUID_ROUTE}/stat-card`");
    expect(source).toContain("`${UUID_ROUTE}/ctc`");
  });
});

describe("GET /api/employees/:id falls through to the redacted handler", () => {
  it("with only stat-card/ctc registered on the secure router, a plain :id request reaches the generic router", async () => {
    // Mirrors the real employee.secure.routes.ts surface post-fix: UUID-suffixed
    // routes only, no bare UUID_ROUTE handler.
    const secure = express.Router();
    secure.get("/:id([0-9a-fA-F-]{36})/stat-card", (_req, res) => res.json({ servedBy: "secure-stat-card" }));
    secure.get("/:id([0-9a-fA-F-]{36})/ctc", (_req, res) => res.json({ servedBy: "secure-ctc" }));

    const generic = express.Router();
    generic.get("/:id", (_req, res) => res.json({ servedBy: "generic-redacted" }));

    const app = express()
      .use("/api/employees", secure)
      .use("/api/employees", generic);

    const uuid = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    const res = await request(app).get(`/api/employees/${uuid}`);

    expect(res.body.servedBy).toBe("generic-redacted");
  });

  it("stat-card and ctc sub-paths are unaffected and still resolve on the secure router", async () => {
    const secure = express.Router();
    secure.get("/:id([0-9a-fA-F-]{36})/stat-card", (_req, res) => res.json({ servedBy: "secure-stat-card" }));
    secure.get("/:id([0-9a-fA-F-]{36})/ctc", (_req, res) => res.json({ servedBy: "secure-ctc" }));

    const generic = express.Router();
    generic.get("/:id", (_req, res) => res.json({ servedBy: "generic-redacted" }));
    generic.get("/:id/stat-card", (_req, res) => res.json({ servedBy: "generic-stat-card" }));

    const app = express()
      .use("/api/employees", secure)
      .use("/api/employees", generic);

    const uuid = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    const statCardRes = await request(app).get(`/api/employees/${uuid}/stat-card`);
    const ctcRes = await request(app).get(`/api/employees/${uuid}/ctc`);

    expect(statCardRes.body.servedBy).toBe("secure-stat-card");
    expect(ctcRes.body.servedBy).toBe("secure-ctc");
  });
});
