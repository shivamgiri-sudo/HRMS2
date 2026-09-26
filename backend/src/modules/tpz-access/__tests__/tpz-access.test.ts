import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------ db + auth doubles ------------------------------ */
const state = {
  restrict: 0,
  grants: [] as Array<Record<string, unknown>>,
  branchRows: [] as Array<{ branch_id: string; process_code: string }>,
  batch: null as null | { upload_type_code: string; uploaded_by: string },
};

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      if (/FROM tpz_user_access/.test(sql)) return [[{ restrict_to_grants: state.restrict }], undefined];
      if (/FROM tpz_access_grant/.test(sql)) return [state.grants, undefined];
      if (/FROM process_master/.test(sql)) return [state.branchRows, undefined];
      if (/FROM upload_batch WHERE id/.test(sql)) return [state.batch ? [state.batch] : [], undefined];
      if (/FROM user_roles/.test(sql)) return [[], undefined];
      return [[], undefined];
    }),
  },
}));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn(async () => undefined) }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: { headers: Record<string, unknown>; authUser?: unknown }, _res: unknown, next: () => void) => {
    req.authUser = req.headers["x-test-user"];
    next();
  },
}));

import { resolveTpzAccess, canTpz, visibleCompanies } from "../tpz-access.resolver.js";
import { companyForPerformancePath, companyForInboundKey, TPZ_UPLOAD_TYPES } from "../tpz-access.catalog.js";
import { invalidateTpzAccessCache } from "../tpz-access.service.js";
import { tpzPerformanceGate, tpzUploadGate, tpzInsightsGate, tpzAllowsUploadType } from "../tpz-access.middleware.js";

const none = new Map<string, string[]>();
const g = (over: Record<string, unknown>) => ({ scope_type: "company", company_key: null, branch_id: null, can_dashboards: true, can_upload: false, can_mis: false, ...over }) as never;

describe("resolveTpzAccess", () => {
  it("leaves a role-based user with everything, exactly as today", () => {
    const a = resolveTpzAccess({ roles: ["manager"], restrict: false, grants: [], branchCompanies: none });
    expect(canTpz(a, "bellavita", "dashboards")).toBe(true);
    expect(canTpz(a, "dalmia", "mis")).toBe(true);
    expect(canTpz(a, "dalmia", "upload")).toBe(false); // a manager was never in the bulk-upload role list
    expect(a.restricted).toBe(false);
  });

  it("narrows a role-based user only when explicitly restricted", () => {
    const a = resolveTpzAccess({ roles: ["manager"], restrict: true, grants: [g({ company_key: "dalmia" })], branchCompanies: none });
    expect(canTpz(a, "dalmia", "dashboards")).toBe(true);
    expect(canTpz(a, "bellavita", "dashboards")).toBe(false);
    expect(visibleCompanies(a)).toEqual(["dalmia"]);
  });

  it("never narrows admin / super_admin, whatever the flag says", () => {
    for (const role of ["admin", "super_admin"]) {
      const a = resolveTpzAccess({ roles: [role], restrict: true, grants: [], branchCompanies: none });
      expect(canTpz(a, "bellavita", "dashboards")).toBe(true);
      expect(canTpz(a, "bellavita", "upload")).toBe(true);
    }
  });

  it("gives an employee only the granted process and capabilities", () => {
    const a = resolveTpzAccess({ roles: ["employee"], restrict: false, grants: [g({ company_key: "neemans", can_upload: true })], branchCompanies: none });
    expect(canTpz(a, "neemans", "dashboards")).toBe(true);
    expect(canTpz(a, "neemans", "upload")).toBe(true);
    expect(canTpz(a, "neemans", "mis")).toBe(false);
    expect(canTpz(a, "clovia", "dashboards")).toBe(false);
    expect(a.roleFullView).toBe(false);
  });

  it("expands a branch grant to the processes mapped to that branch, and an 'all' grant to everything", () => {
    const branch = resolveTpzAccess({
      roles: ["employee"], restrict: false, grants: [g({ scope_type: "branch", branch_id: "B1", can_mis: true })],
      branchCompanies: new Map([["B1", ["bellavita", "gnc"]]]),
    });
    expect(visibleCompanies(branch)).toEqual(["bellavita", "gnc"]);
    expect(canTpz(branch, "gnc", "mis")).toBe(true);
    const all = resolveTpzAccess({ roles: ["employee"], restrict: false, grants: [g({ scope_type: "all" })], branchCompanies: none });
    expect(canTpz(all, "viega", "dashboards")).toBe(true);
    expect(canTpz(all, "viega", "upload")).toBe(false);
  });

  it("ORs overlapping grants", () => {
    const a = resolveTpzAccess({
      roles: ["employee"], restrict: false,
      grants: [g({ company_key: "gnc" }), g({ scope_type: "branch", branch_id: "B1", can_upload: true })],
      branchCompanies: new Map([["B1", ["gnc"]]]),
    });
    expect(a.companies.gnc).toEqual({ dashboards: true, upload: true, mis: false });
  });
});

describe("catalogue paths", () => {
  it("maps dashboard paths, MIS paths and inbound keys to their process", () => {
    expect(companyForPerformancePath("/bellavita-sale-dashboard")).toEqual({ company: "bellavita", capability: "dashboards" });
    expect(companyForPerformancePath("/bellavita-sale-dashboard/date-lob-matrix")?.company).toBe("bellavita");
    expect(companyForPerformancePath("/clovia-lob/email/detail")?.company).toBe("clovia");
    expect(companyForPerformancePath("/dalmia-dashboard")?.company).toBe("dalmia");
    expect(companyForPerformancePath("/mis/gnc/excel")).toEqual({ company: "gnc", capability: "mis" });
    expect(companyForPerformancePath("/processes")).toBeNull();
    expect(companyForPerformancePath("/bellavita-sale-dashboardX")).toBeNull();
    expect(companyForInboundKey("Neemans")).toBe("neemans");
    expect(companyForInboundKey("nope")).toBeNull();
  });
  it("knows every uploader's import function", () => {
    expect(TPZ_UPLOAD_TYPES.get("DALMIA_APR")).toEqual({ company: "dalmia", rpc: "import_dalmia_apr_batch" });
    expect(TPZ_UPLOAD_TYPES.get("BB_SALE_MASMIS")?.company).toBe("bellavita");
  });
});

/* ----------------------------------- the gates ----------------------------------- */
type Req = Record<string, unknown> & { tpzBypass?: boolean };
function run(gate: unknown, opts: { user: Record<string, unknown>; method?: string; path: string; body?: unknown }) {
  const req: Req = { method: opts.method ?? "GET", path: opts.path, body: opts.body, headers: { "x-test-user": opts.user } };
  return new Promise<{ status: number | null; passed: boolean; req: Req; json?: unknown }>((resolve) => {
    const res = {
      status(code: number) { this._s = code; return this; },
      json(payload: unknown) { resolve({ status: (this as unknown as { _s: number })._s, passed: false, req, json: payload }); },
      _s: 200,
    };
    (gate as (rq: unknown, rs: unknown, nx: (e?: unknown) => void) => void)(req, res, () => resolve({ status: null, passed: true, req }));
  });
}
const employee = { id: "u-emp", roles: ["employee"] };
const manager = { id: "u-mgr", roles: ["manager"] };

describe("dashboard gate", () => {
  beforeEach(() => { state.restrict = 0; state.grants = []; state.branchRows = []; state.batch = null; invalidateTpzAccessCache(); });

  it("does not touch a path the catalogue does not govern", async () => {
    const r = await run(tpzPerformanceGate, { user: employee, path: "/processes" });
    expect(r.passed).toBe(true);
    expect(r.req.tpzBypass).toBeUndefined();
  });

  it("lets a granted employee read that process (and only via GET)", async () => {
    state.grants = [{ scope_type: "company", company_key: "bellavita", branch_id: null, can_dashboards: 1, can_upload: 0, can_mis: 0 }];
    const ok = await run(tpzPerformanceGate, { user: employee, path: "/bellavita-sale-dashboard" });
    expect(ok.passed).toBe(true);
    expect(ok.req.tpzBypass).toBe(true);
    const write = await run(tpzPerformanceGate, { user: employee, method: "PUT", path: "/bellavita-sale-dashboard/monthly-target" });
    expect(write.passed).toBe(true);
    expect(write.req.tpzBypass).toBeUndefined(); // the route's own admin role list still refuses a write
  });

  it("refuses a process the employee was not granted", async () => {
    state.grants = [{ scope_type: "company", company_key: "bellavita", branch_id: null, can_dashboards: 1, can_upload: 0, can_mis: 0 }];
    const r = await run(tpzPerformanceGate, { user: employee, path: "/dalmia-dashboard" });
    expect(r.status).toBe(403);
  });

  it("refuses MIS unless the grant carries it", async () => {
    state.grants = [{ scope_type: "company", company_key: "gnc", branch_id: null, can_dashboards: 1, can_upload: 0, can_mis: 0 }];
    expect((await run(tpzPerformanceGate, { user: employee, path: "/mis/gnc/excel" })).status).toBe(403);
    state.grants[0].can_mis = 1; invalidateTpzAccessCache();
    expect((await run(tpzPerformanceGate, { user: employee, path: "/mis/gnc/excel" })).passed).toBe(true);
  });

  it("leaves an unrestricted manager alone, and narrows a restricted one", async () => {
    expect((await run(tpzPerformanceGate, { user: manager, path: "/dalmia-dashboard" })).passed).toBe(true);
    state.restrict = 1; state.grants = [{ scope_type: "company", company_key: "gnc", branch_id: null, can_dashboards: 1, can_upload: 0, can_mis: 0 }]; invalidateTpzAccessCache();
    expect((await run(tpzPerformanceGate, { user: manager, path: "/dalmia-dashboard" })).status).toBe(403);
    expect((await run(tpzPerformanceGate, { user: manager, path: "/gnc-sale-dashboard" })).passed).toBe(true);
  });

  it("gates the inbound insights by project key", async () => {
    state.grants = [{ scope_type: "company", company_key: "neemans", branch_id: null, can_dashboards: 1, can_upload: 0, can_mis: 0 }];
    expect((await run(tpzInsightsGate, { user: employee, path: "/neemans/calls" })).passed).toBe(true);
    expect((await run(tpzInsightsGate, { user: employee, path: "/bellavita" })).status).toBe(403);
  });

  it("falls back to role-based access when the grant tables cannot be read", async () => {
    const { db } = await import("../../../db/mysql.js");
    (db.execute as unknown as { mockImplementationOnce: (f: () => never) => void }).mockImplementationOnce(() => { throw Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" }); });
    invalidateTpzAccessCache();
    expect((await run(tpzPerformanceGate, { user: manager, path: "/gnc-sale-dashboard" })).passed).toBe(true);
  });
});

describe("percent-encoded inbound key", () => {
  beforeEach(() => { state.restrict = 0; state.grants = []; state.branchRows = []; state.batch = null; invalidateTpzAccessCache(); });

  it("is decoded before the gate looks the company up, so encoding cannot skip a refusal", async () => {
    state.grants = [{ scope_type: "company", company_key: "bellavita", branch_id: null, can_dashboards: 1, can_upload: 0, can_mis: 0 }];
    const plain = await run(tpzInsightsGate, { user: employee, path: "/neemans/calls" });
    const encoded = await run(tpzInsightsGate, { user: employee, path: "/neem%61ns/calls" });
    expect(plain.status).toBe(403);
    expect(encoded.status).toBe(403);
  });

  it("treats a malformed escape as no key and passes it on (the router rejects it)", async () => {
    const r = await run(tpzInsightsGate, { user: employee, path: "/neem%zzns/calls" });
    expect(r.passed).toBe(true);
    expect(r.req.tpzBypass).toBeUndefined();
  });
});

describe("uploader gate", () => {
  beforeEach(() => { state.restrict = 0; state.grants = []; state.batch = null; invalidateTpzAccessCache(); });
  const grantDalmiaUpload = () => { state.grants = [{ scope_type: "company", company_key: "dalmia", branch_id: null, can_dashboards: 0, can_upload: 1, can_mis: 0 }]; invalidateTpzAccessCache(); };

  it("does nothing for an admin", async () => {
    const r = await run(tpzUploadGate, { user: { id: "a", roles: ["admin"] }, method: "POST", path: "/batches", body: { upload_type_code: "BB_SALE_MASMIS" } });
    expect(r.passed).toBe(true);
    expect(r.req.tpzBypass).toBeUndefined();
  });

  it("lets a granted employee create a batch only of a granted type", async () => {
    grantDalmiaUpload();
    const ok = await run(tpzUploadGate, { user: employee, method: "POST", path: "/batches", body: { upload_type_code: "DALMIA_APR" } });
    expect(ok.passed).toBe(true);
    expect(ok.req.tpzBypass).toBe(true);
    expect((await run(tpzUploadGate, { user: employee, method: "POST", path: "/batches", body: { upload_type_code: "BB_SALE_MASMIS" } })).status).toBe(403);
    expect((await run(tpzUploadGate, { user: employee, method: "POST", path: "/batches", body: { upload_type_code: "ATTENDANCE_REGULARIZATION" } })).status).toBe(403);
  });

  it("only lets them work on their own batch, with the matching import function", async () => {
    grantDalmiaUpload();
    const id = "11111111-2222-3333-4444-555555555555";
    state.batch = { upload_type_code: "DALMIA_APR", uploaded_by: "someone-else" };
    expect((await run(tpzUploadGate, { user: employee, method: "POST", path: `/batches/${id}/rows`, body: [] })).status).toBe(403);
    state.batch = { upload_type_code: "DALMIA_APR", uploaded_by: employee.id };
    expect((await run(tpzUploadGate, { user: employee, method: "POST", path: `/batches/${id}/import`, body: { rpc_name: "import_attendance_regularization_batch" } })).status).toBe(403);
    const ok = await run(tpzUploadGate, { user: employee, method: "POST", path: `/batches/${id}/import`, body: { rpc_name: "import_dalmia_apr_batch" } });
    expect(ok.passed).toBe(true);
    expect(ok.req.tpzBypass).toBe(true);
    state.batch = { upload_type_code: "BB_SALE_MASMIS", uploaded_by: employee.id };
    expect((await run(tpzUploadGate, { user: employee, method: "GET", path: `/batches/${id}/rows` })).status).toBe(403);
  });

  it("filters the template / history lists for a grant-only user", async () => {
    grantDalmiaUpload();
    const r = await run(tpzUploadGate, { user: employee, path: "/templates" });
    expect(r.passed).toBe(true);
    expect(r.req.tpzBypass).toBe(true);
    expect(tpzAllowsUploadType(r.req as never, "DALMIA_APR")).toBe(true);
    expect(tpzAllowsUploadType(r.req as never, "DALMIA_DD_RAW")).toBe(true); // same process, same grant
    expect(tpzAllowsUploadType(r.req as never, "BB_SALE_MASMIS")).toBe(false);
    expect(tpzAllowsUploadType(r.req as never, "ATTENDANCE_REGULARIZATION")).toBe(false);
  });

  it("hides only the denied TPZ types from a role-admitted user who has been narrowed", async () => {
    const wfm = { id: "w", roles: ["wfm"] };
    state.restrict = 1; grantDalmiaUpload();
    const r = await run(tpzUploadGate, { user: wfm, path: "/templates" });
    expect(r.passed).toBe(true);
    expect(r.req.tpzBypass).toBeUndefined();
    expect(tpzAllowsUploadType(r.req as never, "DALMIA_APR")).toBe(true);
    expect(tpzAllowsUploadType(r.req as never, "BB_SALE_MASMIS")).toBe(false);
    expect(tpzAllowsUploadType(r.req as never, "ATTENDANCE_REGULARIZATION")).toBe(true); // not a TPZ type: untouched
  });

  it("stays out of the way for a user with no upload grant", async () => {
    const r = await run(tpzUploadGate, { user: employee, method: "POST", path: "/batches", body: { upload_type_code: "DALMIA_APR" } });
    expect(r.passed).toBe(true);
    expect(r.req.tpzBypass).toBeUndefined(); // the route's own role list answers 403
  });
});
