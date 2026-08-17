import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The imprest API is actually reachable (Requirements 6, 7, 8).
 *
 * The services behind these endpoints were written, fully tested and completely unreachable —
 * no routes file, nothing mounted. A green unit-test run says nothing about that, and probing
 * cannot detect it either: a nonexistent /api/* path 401s exactly like a real one, because
 * requireAuth sits on the prefix. The registered route table is the only thing that can tell
 * the difference, so that is what this asserts.
 *
 * The second half is about scope. Every read must resolve the caller's branch entitlement
 * server-side, and the export must resolve it the same way as its list — an export that returns
 * a row its list would not is a data leak wearing a CSV extension.
 */

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]), query: vi.fn().mockResolvedValue([[], []]), getConnection: vi.fn() },
  pingDb: vi.fn(),
}));
vi.mock("../../../db/supabaseAdmin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));

let registered: { method: string; path: string }[];

beforeAll(async () => {
  const { app } = await import("../../../app.js");
  const { enumerateRoutes } = await import("../../../platform/route-contract.js");
  registered = enumerateRoutes(app).map((route) => ({
    method: String(route.method).toUpperCase(),
    path: String(route.path),
  }));
  // 420s, not the default. This hook imports the ENTIRE Express app to read its route table,
  // which is the only way to prove a route is really mounted — a nonexistent /api path 401s
  // exactly like a real one. Under a full parallel run two workers do that cold import at once
  // and 180s was not enough; the tests pass individually. Mocking the app away would delete the
  // only thing these files actually check.
}, 420_000);

/**
 * Parameter names are normalised away before comparing. enumerateRoutes recovers paths from
 * Express's compiled regexps, so ":id" comes back as ":p" — matching on the literal name would
 * assert the enumerator's placeholder convention rather than the route's existence.
 */
const normalise = (path: string) => path.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":x");

const has = (method: string, path: string) =>
  registered.some(
    (route) => route.method === method && normalise(route.path) === normalise(path),
  );

describe("the imprest endpoints are mounted", () => {
  it.each([
    ["GET", "/api/finance/imprest/managers"],
    ["GET", "/api/finance/imprest/managers/:id"],
    ["POST", "/api/finance/imprest/managers"],
    ["PUT", "/api/finance/imprest/managers/:id"],
    ["GET", "/api/finance/imprest/allocations"],
    ["POST", "/api/finance/imprest/allocations"],
    ["POST", "/api/finance/imprest/allocations/:id/review"],
    ["GET", "/api/finance/imprest/ledger"],
    ["GET", "/api/finance/imprest/reports/balance"],
    // The Imprest Details report, in the supplied workbook's format. It REPLACED a generic
    // ledger CSV added earlier in the same session: that one produced a non-conforming file,
    // and leaving both would put a wrong export next to the right one for someone to pick.
    ["GET", "/api/finance/imprest/reports/details"],
    ["GET", "/api/finance/imprest/reports/details/export"],
    // Without this, Requirement 8's master has read paths only — nobody can be appointed, so no
    // float is ever funded and every approved voucher skips its debit.
    ["GET", "/api/finance/imprest/manager-candidates"],
    // finance_approval_event had five writers and no reader wired to an endpoint, so a returned
    // voucher recorded exactly why and nobody could read it back.
    ["GET", "/api/finance/imprest/allocations/:id/approval-history"],
  ])("%s %s", (method, path) => {
    expect(has(method, path), `${method} ${path} is not registered`).toBe(true);
  });

  it("is mounted under its own prefix, so grnRouter cannot shadow it", () => {
    // grnRouter mounts at bare /api/finance and carries "/grns/:id"-shaped routes. A bare
    // imprest mount would be at the mercy of registration order.
    const imprest = registered.filter((route) => route.path.startsWith("/api/finance/imprest"));
    expect(imprest.length).toBeGreaterThanOrEqual(10);
  });
});

describe("scope is resolved server-side, never trusted from the query", () => {
  let SRC: string;
  beforeAll(async () => {
    const { readFileSync } = await import("fs");
    SRC = readFileSync(
      new URL("../imprest.routes.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
      "utf8",
    );
  });

  it("passes a resolved branchScope to every list, not a raw branchId", () => {
    // A service call taking req.query.branchId directly would let any authenticated user read
    // any branch's float by editing the URL.
    const listCalls = SRC.match(/branchScope: await scopeOf\(req\)/g) ?? [];
    expect(listCalls.length, "every read resolves scope").toBeGreaterThanOrEqual(5);
    expect(SRC).not.toMatch(/branchId:\s*String\(req\.query\.branchId\)/);
  });

  it("routes the export through the same resolver as its list", () => {
    const exportBlock = SRC.slice(SRC.indexOf('"/reports/details/export"'));
    expect(exportBlock).toContain("branchScope: await scopeOf(req)");
  });

  it("checks the branch on create, because an allocation moves real money", () => {
    const createBlock = SRC.slice(SRC.indexOf('imprestRouter.post(\n  "/allocations"'));
    expect(createBlock).toContain("scope.mode === \"branches\"");
    expect(createBlock).toContain("403");
  });

  it("restricts allocation entry to Finance Head and Super Admin", () => {
    // Owner ruling 2026-08-17. accounts_head previously shared allocation entry, on the reading
    // that raising against an existing appointment is operational. The owner placed the decision
    // with Finance Head instead: an allocation releases company money into a branch float, so the
    // two role sets are now deliberately identical rather than master-narrower-than-entry.
    expect(SRC).toContain('const IMPREST_MASTER_ROLES = ["finance_head", "super_admin"] as const;');
    expect(SRC).toContain('const IMPREST_WRITE_ROLES = ["finance_head", "super_admin"] as const;');
    // accounts_head must not creep back into either.
    expect(SRC).not.toMatch(/IMPREST_(MASTER|WRITE)_ROLES = \[[^\]]*accounts_head/);
  });

  it("gives branch_head no part in raising or approving an allocation", () => {
    // The float is handed by Finance Head directly to the Branch Admin who spends it; the branch
    // does not approve its own funding. branch_head keeps READ access only.
    const at = SRC.indexOf('"/allocations/:id/review"');
    // Comments stripped: the block carries a note explaining WHY branch_head was removed, and a
    // bare not.toContain would match that prose rather than a live requireRole argument.
    const reviewBlock = SRC.slice(at, at + 400).replace(/\/\/.*$/gm, "");
    expect(reviewBlock).not.toContain("branch_head");
    expect(reviewBlock).toContain('requireRole("finance_head", "super_admin")');
  });

  it("guards every write with requireWriteAccess as well as a role", () => {
    const writes = [...SRC.matchAll(/imprestRouter\.(post|put)\(\s*"([^"]+)"/g)];
    expect(writes.length).toBeGreaterThanOrEqual(4);
    for (const write of writes) {
      const block = SRC.slice(write.index ?? 0, (write.index ?? 0) + 260);
      expect(block, `${write[1]} ${write[2]} must require write access`).toContain("requireWriteAccess");
      expect(block, `${write[1]} ${write[2]} must require a role`).toContain("requireRole(");
    }
  });
});

describe("the ledger reads honour scope", () => {
  it("applies the entitlement to opening as well as movements", async () => {
    // Opening, movements and closing are three queries over one window. Scoping only the
    // movements would produce a closing balance that does not equal opening plus movements.
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      new URL("../imprest-ledger.service.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
      "utf8",
    );
    const summary = src.slice(src.indexOf("async getPeriodSummary"));
    expect(summary).toContain("financeBranchFilter(filters.branchScope");
    // The shared predicate is built once and appended to every query in the method.
    expect(summary).toContain("scopeSql");
  });

  it("keeps the ledger append-only — no update or delete path", () => {
    const { readFileSync } = require("fs") as typeof import("fs");
    const src = readFileSync(
      new URL("../imprest-ledger.service.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
      "utf8",
    );
    // A wrong entry is corrected with a contra entry. MySQL TRIGGERs are unavailable here, so
    // this scan is the only enforcement the rule has.
    expect(src).not.toMatch(/UPDATE\s+imprest_transaction_ledger/i);
    expect(src).not.toMatch(/DELETE\s+FROM\s+imprest_transaction_ledger/i);
  });
});
