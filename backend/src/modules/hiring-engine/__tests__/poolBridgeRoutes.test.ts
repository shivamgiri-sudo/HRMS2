import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  execute: vi.fn(), bridge: vi.fn(), sources: vi.fn(), refresh: vi.fn(async () => ({ refreshed: 1 })),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: h.execute, query: h.execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});
vi.mock("../he-upload-bridge.service.js", async (orig) => ({ ...(await orig<typeof import("../he-upload-bridge.service.js")>()), bridgeAtsUpload: h.bridge, bridgeSources: h.sources }));
vi.mock("../../selection/fact-cache.service.js", () => ({ refreshFactCache: h.refresh, readFactCache: vi.fn(), factsHashOf: vi.fn() }));

import { heRouter } from "../he.routes.js";

function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/he", heRouter);
  return app;
}
const result = (dryRun: boolean) => ({ dryRun, batches: [], totals: { scanned: 3, inserted: 2, enriched: 1, skipped: { legacy_employee: 0, test: 0, no_mobile: 0, employee: 0, duplicate_mobile: 0 } }, next: null });

beforeEach(() => {
  vi.clearAllMocks();
  h.execute.mockResolvedValue([[]]);
  h.bridge.mockImplementation(async (i: { dryRun: boolean }) => result(i.dryRun));
  h.sources.mockResolvedValue([{ recordType: "naukri_import", sourceDetails: "SBI AHM_1.xlsx", rows: 155, inPool: 0 }]);
});

describe("pool bridge routes (WS3 D2)", () => {
  it("is a dry run unless dryRun is explicitly false; org-wide admins only (a branch-scoped admin gets 403)", async () => {
    const r = await request(appFor("super_admin")).post("/api/he/pool/bridge-ats").send({ recordTypes: ["naukri_import"] });
    expect(r.status).toBe(200);
    expect(h.bridge).toHaveBeenCalledWith(expect.objectContaining({ recordTypes: ["naukri_import"], dryRun: true, actorId: "u-super_admin" }));
    h.bridge.mockClear();
    expect((await request(appFor("admin")).post("/api/he/pool/bridge-ats").send({ recordTypes: ["naukri_import"] })).status).toBe(403);
    expect((await request(appFor("admin")).get("/api/he/pool/bridge-ats/sources")).status).toBe(403);
    expect(h.bridge).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
    expect((await request(appFor("hr")).post("/api/he/pool/bridge-ats").send({ recordTypes: ["naukri_import"] })).status).toBe(403);
    expect((await request(appFor("ceo")).get("/api/he/pool/bridge-ats/sources")).status).toBe(403);
  });

  it("sourceDetails is bounded: at most 50 entries of at most 200 characters", async () => {
    const a = appFor("super_admin");
    expect((await request(a).post("/api/he/pool/bridge-ats").send({ recordTypes: ["naukri_import"], sourceDetails: Array.from({ length: 51 }, (_, i) => `f${i}`) })).status).toBe(400);
    expect((await request(a).post("/api/he/pool/bridge-ats").send({ recordTypes: ["naukri_import"], sourceDetails: ["x".repeat(201)] })).status).toBe(400);
    expect((await request(a).post("/api/he/pool/bridge-ats").send({ recordTypes: ["naukri_import"], sourceDetails: ["SBI AHM_1.xlsx"] })).status).toBe(200);
  });
  it("a real run refreshes the Hiring Engine facts cache in the background, so the preview sees the new people", async () => {
    const r = await request(appFor("super_admin")).post("/api/he/pool/bridge-ats").send({ recordTypes: ["naukri_import", "workindia_import"], dryRun: false });
    expect(r.status).toBe(200);
    expect(r.body.data.totals.inserted).toBe(2);
    expect(r.body.data.next_step).toContain("Selection criteria");
    expect(h.refresh).toHaveBeenCalledWith(expect.objectContaining({ sourceKind: "he", subSources: ["naukri_import", "workindia_import"] }));
  });

  it("validates the body", async () => {
    expect((await request(appFor("super_admin")).post("/api/he/pool/bridge-ats").send({ recordTypes: ["legacy_employee"] })).status).toBe(400);
    expect((await request(appFor("super_admin")).post("/api/he/pool/bridge-ats").send({})).status).toBe(400);
    expect((await request(appFor("super_admin")).post("/api/he/pool/bridge-ats").send({ recordTypes: ["naukri_import"], maxRows: "x" })).status).toBe(400);
  });

  it("lists the import files with their pool coverage", async () => {
    const r = await request(appFor("super_admin")).get("/api/he/pool/bridge-ats/sources");
    expect(r.status).toBe(200);
    expect(r.body.data[0]).toEqual({ recordType: "naukri_import", sourceDetails: "SBI AHM_1.xlsx", rows: 155, inPool: 0 });
  });

  it("a running bridge answers 409 with its message", async () => {
    h.bridge.mockRejectedValueOnce(Object.assign(new Error("A pool bridge run is already going; try again when it ends"), { statusCode: 409 }));
    const r = await request(appFor("super_admin")).post("/api/he/pool/bridge-ats").send({ recordTypes: ["naukri_import"], dryRun: false });
    expect(r.status).toBe(409);
  });
});
