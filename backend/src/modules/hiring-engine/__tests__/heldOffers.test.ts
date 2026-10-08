import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const warn = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn, info: vi.fn(), error: vi.fn() } }));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});

import { clearHeldOffersCache, listHeldOffers } from "../he-best-offer.service.js";
import { heRouter } from "../he.routes.js";

const ON = { HE_BEST_OFFER: "true", QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv;
const ALL = { all: true } as const;
const PUNE = { all: false, branchName: "Pune" } as const;

let candidates: unknown[] = [];
let siblings: unknown[] = [];
let failSiblings = false;
const sqls = () => execute.mock.calls.map((c) => String(c[0]));
beforeEach(() => {
  vi.clearAllMocks(); clearHeldOffersCache();
  candidates = [{ id: "qf2", full_name: "Asha", mobile10: "9876543210", requisition_id: "req2", source_type: "meta_live", qualified_at: new Date("2026-10-07T04:00:00Z") }];
  siblings = [
    { id: "qf1", mobile10: "9876543210", requisition_id: "req1", requisition_code: "RQ-1", qualified_at: "2026-10-07 09:00:00", started: 1, declined: 0, distance_km: null, score: null, remaining: 3 },
    { id: "qf2", mobile10: "9876543210", requisition_id: "req2", requisition_code: "RQ-2", qualified_at: "2026-10-07 09:30:00", started: 0, declined: 0, distance_km: null, score: null, remaining: 3 },
  ];
  failSiblings = false;
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM employees e")) return [[{ branch_name: "Pune" }]];
    if (q.includes("FROM qualified_followup qf") && q.includes("LEFT JOIN he_lead")) { if (failSiblings) throw Object.assign(new Error("boom 9876543210"), { code: "ER_X" }); return [siblings]; }
    if (q.includes("FROM qualified_followup qf")) return [candidates];
    return [[]];
  });
});
afterEach(() => { clearHeldOffersCache(); });

describe("listHeldOffers", () => {
  it("is empty and issues no query when HE_BEST_OFFER is off or the follow-up mode is off", async () => {
    for (const env of [{ QUAL_FOLLOWUP_MODE: "live" }, { HE_BEST_OFFER: "1", QUAL_FOLLOWUP_MODE: "live" }, { HE_BEST_OFFER: "true" }] as NodeJS.ProcessEnv[]) {
      expect(await listHeldOffers(ALL, env)).toEqual({ enabled: false, rows: [], truncated: false, partial: false });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns the held row with the requisition holding it", async () => {
    const r = await listHeldOffers(ALL, ON);
    expect(r).toEqual({
      enabled: true, truncated: false, partial: false,
      rows: [{ id: "qf2", name: "Asha", mobileMasked: "xxxxxx3210", requisitionId: "req2", requisitionCode: "RQ-2", sourceType: "meta_live", status: "held_other_offer",
        heldFor: { requisitionCode: "RQ-1", why: "already_offered" }, qualifiedAt: "2026-10-07T04:00:00.000Z" }],
    });
    expect(JSON.stringify(r)).not.toMatch(/\d{10}/);
  });

  it("a zone-less IST DATETIME string gets an explicit +05:30 offset", async () => {
    candidates = [{ ...(candidates[0] as object), qualified_at: "2026-10-07 09:30:00" }];
    const r = await listHeldOffers(ALL, ON);
    expect(r.rows[0].qualifiedAt).toBe("2026-10-07T09:30:00+05:30");
  });

  it("the Pune scope puts the branch on the held row with the collation on the parameter side", async () => {
    await listHeldOffers(PUNE, ON);
    const q = sqls().find((s) => s.includes("qf.branch_name"))!;
    expect(q).toContain("qf.branch_name = ? COLLATE utf8mb4_unicode_ci");
    expect(execute.mock.calls.find((c) => String(c[0]).includes("qf.branch_name"))![1]).toEqual(["live", "Pune"]);
    expect(await listHeldOffers({ all: false, branchName: null }, ON)).toMatchObject({ enabled: true, rows: [] });
  });

  it("caches 60 s per scope; a read error is partial, empty, logged by code and not cached", async () => {
    await listHeldOffers(ALL, ON, 1000); await listHeldOffers(ALL, ON, 30_000);
    expect(sqls().filter((s) => s.includes("LEFT JOIN he_lead"))).toHaveLength(1);
    await listHeldOffers(PUNE, ON, 30_000);
    expect(sqls().filter((s) => s.includes("LEFT JOIN he_lead"))).toHaveLength(2);
    await listHeldOffers(ALL, ON, 61_001);
    expect(sqls().filter((s) => s.includes("LEFT JOIN he_lead"))).toHaveLength(3);
    clearHeldOffersCache(); failSiblings = true;
    expect(await listHeldOffers(ALL, ON)).toEqual({ enabled: true, rows: [], truncated: false, partial: true });
    expect(warn).toHaveBeenCalledWith({ code: "ER_X" }, expect.any(String));
    failSiblings = false;
    expect((await listHeldOffers(ALL, ON)).rows).toHaveLength(1);
  });

  it("reads at most 500 and flags truncation", async () => {
    candidates = Array.from({ length: 501 }, (_, i) => ({ id: `c${i}`, full_name: null, mobile10: "9876543210", requisition_id: "req2", source_type: "he", qualified_at: "2026-10-07" }));
    const r = await listHeldOffers(ALL, ON);
    expect(r.truncated).toBe(true);
    expect(sqls().find((s) => s.includes("qf.branch_name") || s.includes("EXISTS"))).toContain("LIMIT 501");
  });
});

describe("GET /qualified-followup/held", () => {
  const appFor = (role: string) => {
    actor = { id: `u-${role}`, role, roles: [role] };
    const app = express(); app.use(express.json()); app.use("/api/he", heRouter);
    return app;
  };
  afterEach(() => { delete process.env.HE_BEST_OFFER; delete process.env.QUAL_FOLLOWUP_MODE; });

  it("is routed before /qualified-followup/:id (200, not its 400), off by default with no query", async () => {
    const r = await request(appFor("ceo")).get("/api/he/qualified-followup/held");
    expect([r.status, r.body]).toEqual([200, { success: true, data: { enabled: false, rows: [], truncated: false, partial: false } }]);
    expect(sqls().filter((s) => s.includes("qualified_followup"))).toHaveLength(0);
  });
  it("answers rows when on, scoped to the caller's branch for hr; 403 for an employee; no phone digits", async () => {
    process.env.HE_BEST_OFFER = "true"; process.env.QUAL_FOLLOWUP_MODE = "live";
    const r = await request(appFor("hr")).get("/api/he/qualified-followup/held");
    expect(r.status).toBe(200);
    expect(r.body.data.rows[0].heldFor).toEqual({ requisitionCode: "RQ-1", why: "already_offered" });
    expect(execute.mock.calls.find((c) => String(c[0]).includes("qf.branch_name"))![1]).toEqual(["live", "Pune"]);
    expect(JSON.stringify(r.body)).not.toMatch(/\d{10}/);
    expect((await request(appFor("employee")).get("/api/he/qualified-followup/held")).status).toBe(403);
  });
});
