import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

import { db } from "../db/mysql.js";
import { isAccountRevoked } from "../shared/accountStatus.js";
import { requireAuth } from "../middleware/authMiddleware.js";

/**
 * Deactivating an employee did not end their access.
 *
 * requireAuth verified the JWT signature and nothing else, so an access token
 * minted before deactivation stayed valid for its full 24h life. And because
 * HR's "Inactive" action on the employee directory writes employment_status
 * while every auth gate reads active_status, the usual way of marking a leaver
 * inactive ended their access never.
 *
 * These tests fail without the isAccountRevoked() check in requireAuth: the
 * deactivated user's request comes back 200.
 */

const SECRET = process.env.JWT_SECRET || "change-me-jwt-secret-32characters!!";
const mockExecute = db.execute as unknown as ReturnType<typeof vi.fn>;

/** Answer db.execute by SQL shape, so the test does not depend on call order. */
function stubDb(opts: { isBlocked?: number; employeeActive?: number | null; authUserExists?: boolean }) {
  const { isBlocked = 0, employeeActive = 1, authUserExists = true } = opts;
  mockExecute.mockImplementation((sql: string) => {
    if (typeof sql === "string" && sql.includes("employee_active")) {
      return Promise.resolve([
        authUserExists ? [{ is_blocked: isBlocked, employee_active: employeeActive }] : [],
        [],
      ]);
    }
    return Promise.resolve([[], []]);
  });
}

function tokenFor(userId: string) {
  return jwt.sign({ sub: userId, email: `${userId}@teammas.in` }, SECRET, { expiresIn: "24h" });
}

function appWithRequireAuth() {
  const app = express();
  app.get("/probe", requireAuth as never, (_req, res) => res.json({ success: true, reached: true }));
  return app;
}

describe("Account revocation is enforced on every authenticated request", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[], []]);
  });

  describe("isAccountRevoked()", () => {
    it("revokes a deactivated employee (active_status = 0)", async () => {
      stubDb({ employeeActive: 0 });
      await expect(isAccountRevoked("user-deactivated")).resolves.toBe(true);
    });

    it("revokes a blocked auth_user even while the employee row is active", async () => {
      stubDb({ isBlocked: 1, employeeActive: 1 });
      await expect(isAccountRevoked("user-blocked")).resolves.toBe(true);
    });

    it("allows an active employee", async () => {
      stubDb({ employeeActive: 1 });
      await expect(isAccountRevoked("user-active")).resolves.toBe(false);
    });

    it("allows an account with no employees row — admin and service logins are not employees", async () => {
      stubDb({ employeeActive: null });
      await expect(isAccountRevoked("user-no-employee-row")).resolves.toBe(false);
    });

    it("fails OPEN when the database is unreachable, so an outage cannot sign out the company", async () => {
      mockExecute.mockRejectedValue(new Error("ECONNREFUSED"));
      await expect(isAccountRevoked("user-db-down")).resolves.toBe(false);
    });
  });

  describe("requireAuth", () => {
    it("rejects a valid, unexpired token when the employee has been deactivated", async () => {
      stubDb({ employeeActive: 0 });
      const res = await request(appWithRequireAuth())
        .get("/probe")
        .set("Authorization", `Bearer ${tokenFor("req-deactivated")}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("ACCOUNT_DEACTIVATED");
      expect(res.body.reached).toBeUndefined();
    });

    it("rejects a valid token when the auth_user is blocked", async () => {
      stubDb({ isBlocked: 1 });
      const res = await request(appWithRequireAuth())
        .get("/probe")
        .set("Authorization", `Bearer ${tokenFor("req-blocked")}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("ACCOUNT_DEACTIVATED");
    });

    it("still admits an active employee", async () => {
      stubDb({ employeeActive: 1 });
      const res = await request(appWithRequireAuth())
        .get("/probe")
        .set("Authorization", `Bearer ${tokenFor("req-active")}`);

      expect(res.status).toBe(200);
      expect(res.body.reached).toBe(true);
    });
  });
});

/**
 * Call-site guards. Revocation only works if it is actually invoked, and call
 * sites in this repository have been removed by unrelated commits before.
 */
describe("Deactivation paths revoke live sessions", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), "utf8");

  it("employee.service.deactivateEmployee revokes sessions after clearing active_status", () => {
    const code = read("../modules/employees/employee.service.ts");
    const fn = code.slice(code.indexOf("async deactivateEmployee"));
    const body = fn.slice(0, fn.indexOf("\n  },"));
    expect(body).toContain("active_status = 0");
    // Matched as a live statement, not merely a mention: an earlier version of
    // this guard passed against a commented-out call.
    expect(body).toMatch(/^\s*(await\s+)?revokeSessionsForEmployee\(/m);
  });

  it("exit.service revokes sessions when an exit reaches 'exited'", () => {
    const code = read("../modules/exit/exit.service.ts");
    const exitedBlock = code.slice(code.indexOf('if (nextStatus === "exited")'));
    expect(exitedBlock).toMatch(/^\s*(const\s+\w+\s*=\s*)?await\s+revokeSessionsForEmployee\(/m);
  });

  it("requireAuth consults the account status check", () => {
    const code = read("../middleware/authMiddleware.ts");
    expect(code).toContain("isAccountRevoked");
    expect(code).toContain("ACCOUNT_DEACTIVATED");
  });
});
