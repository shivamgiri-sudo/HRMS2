import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

/**
 * GET /api/access/users: the old query joined user_roles + GROUP_CONCAT for every account before
 * sorting/paging (about 6s on prod, twice per request). Roles are now aggregated only for the
 * returned page and the count skips that join. Response shape must not change.
 */
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "u1", roles: ["admin"] };
    next();
  },
}));
const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...a: unknown[]) => execute(...a) },
}));
vi.mock("../access.service.js", () => ({}));
vi.mock("../role-page-access.service.js", () => ({}));
vi.mock("../user-page-access.service.js", () => ({}));

const { accessRouter } = await import("../access.routes.js");
const app = () => {
  const a = express();
  a.use(express.json());
  a.use("/api/access", accessRouter);
  return a;
};

describe("GET /api/access/users", () => {
  it("pages first, aggregates roles per page row, and counts without the roles join", async () => {
    execute.mockReset();
    execute.mockImplementation(async (sql: string) =>
      /COUNT\(\*\) AS total/.test(sql)
        ? [[{ total: 7 }], []]
        : [
            [
              {
                id: "a",
                email: "a@x.com",
                is_blocked: 0,
                full_name: "A",
                employee_id: "e1",
                roles: "hr,employee",
                no_account: 0,
              },
            ],
            [],
          ],
    );
    const res = await request(app()).get("/api/access/users?limit=10");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(7);
    expect(res.body.data[0].roles).toEqual(["hr", "employee"]);

    const rowsSql = String(
      execute.mock.calls.find((c) => !/COUNT\(\*\) AS total/.test(c[0]))![0],
    );
    const countSql = String(
      execute.mock.calls.find((c) => /COUNT\(\*\) AS total/.test(c[0]))![0],
    );
    expect(rowsSql).toMatch(/LIMIT 10 OFFSET 0\s*\)\s*AS combined/);
    expect(rowsSql).toMatch(/\(SELECT GROUP_CONCAT\(DISTINCT ur\.role_key/);
    expect(rowsSql).not.toMatch(/GROUP BY au\.id/);
    expect(countSql).not.toMatch(/user_roles/);
  });
});
