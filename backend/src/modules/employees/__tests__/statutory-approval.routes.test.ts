/**
 * GET/PATCH /api/statutory-change-requests — the reviewer that was missing
 * entirely for employee-submitted statutory-detail (PAN/Aadhaar/UAN/ESI/PF)
 * change requests. PUT /me/statutory-details already routed submissions into
 * profile_update_approval (request_type='statutory_details'), but nothing
 * could ever act on them — see the file header comment in
 * statutory-approval.routes.ts for the full history.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const EMPLOYEE_ID = "22222222-2222-2222-2222-222222222222";
const APPROVAL_ID = "33333333-3333-3333-3333-333333333333";

const { getConnection, dbExecute, encryptPanForSync, blindIndexPan, encryptAadhaarForSync, blindIndexAadhaar, logSensitiveAction } = vi.hoisted(() => ({
  getConnection: vi.fn(),
  dbExecute: vi.fn(),
  encryptPanForSync: vi.fn((v: string) => `enc(${v})`),
  blindIndexPan: vi.fn((v: string) => `idx(${v})`),
  encryptAadhaarForSync: vi.fn((v: string) => `aenc(${v})`),
  blindIndexAadhaar: vi.fn((v: string) => `aidx(${v})`),
  logSensitiveAction: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, getConnection } }));
vi.mock("../../../shared/syncPiiEncryption.js", () => ({ encryptPanForSync, blindIndexPan, encryptAadhaarForSync, blindIndexAadhaar }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: ACTOR_ID };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

const { statutoryApprovalRouter } = await import("../statutory-approval.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/statutory-change-requests", statutoryApprovalRouter);
  return a;
}

/** Records every statement in order, keyed loosely by SQL substring. */
function makeConnection(record: Record<string, unknown> | null) {
  const statements: string[] = [];
  const params: unknown[][] = [];
  const conn = {
    statements,
    params,
    execute: vi.fn(async (sql: string, p?: unknown[]) => {
      statements.push(String(sql).replace(/\s+/g, " ").trim());
      params.push(p ?? []);
      if (/SELECT \* FROM profile_update_approval/.test(sql)) return [record ? [record] : [], []];
      return [{ affectedRows: 1 }, []];
    }),
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
  };
  return conn;
}

const PENDING_REQUEST = {
  id: APPROVAL_ID,
  employee_id: EMPLOYEE_ID,
  old_values: JSON.stringify({ pan_number: "OLDPP1234A" }),
  new_values: JSON.stringify({
    pan_number: "NEWPP5678B",
    aadhaar_id: "999988887777",
    uan_number: "100200300400",
    epf_eligible: true,
  }),
  status: "pending",
};

describe("GET /api/statutory-change-requests/pending", () => {
  beforeEach(() => {
    dbExecute.mockReset();
    getConnection.mockReset();
  });

  it("lists only pending statutory_details requests", async () => {
    dbExecute.mockResolvedValueOnce([[{ id: APPROVAL_ID, employee_id: EMPLOYEE_ID, status: "pending" }]]);

    const res = await request(app()).get("/api/statutory-change-requests/pending");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(String(dbExecute.mock.calls[0][0])).toContain("request_type = 'statutory_details'");
    expect(String(dbExecute.mock.calls[0][0])).toContain("status = 'pending'");
  });
});

describe("PATCH /api/statutory-change-requests/:id — approve", () => {
  beforeEach(() => {
    getConnection.mockReset();
    encryptPanForSync.mockClear();
    blindIndexPan.mockClear();
    encryptAadhaarForSync.mockClear();
    blindIndexAadhaar.mockClear();
    logSensitiveAction.mockReset().mockResolvedValue(undefined);
  });

  it("writes PAN with both plaintext and encrypted/blind-index siblings, syncs employees.uan_number", async () => {
    const conn = makeConnection(PENDING_REQUEST);
    getConnection.mockResolvedValue(conn);

    const res = await request(app())
      .patch(`/api/statutory-change-requests/${APPROVAL_ID}`)
      .send({ decision: "approved", note: "verified against PAN card scan" });

    expect(res.status).toBe(200);
    expect(encryptPanForSync).toHaveBeenCalledWith("NEWPP5678B", expect.any(String));
    expect(blindIndexPan).toHaveBeenCalledWith("NEWPP5678B", expect.any(String));

    const statInsert = conn.statements.findIndex((s) => s.includes("INSERT INTO employee_statutory_info"));
    expect(statInsert).toBeGreaterThan(-1);
    expect(conn.params[statInsert]).toContain("NEWPP5678B");
    expect(conn.params[statInsert]).toContain("enc(NEWPP5678B)");
    expect(conn.params[statInsert]).toContain("idx(NEWPP5678B)");
    expect(conn.params[statInsert]).toContain("999988887777");

    const empSync = conn.statements.findIndex((s) => s.includes("UPDATE employees SET uan_number"));
    expect(empSync).toBeGreaterThan(-1);
    expect(conn.params[empSync]).toContain("100200300400");

    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it("propagates an approved PAN/Aadhaar change to the employees table, not just employee_statutory_info", async () => {
    // Regression coverage: employee.routes.ts's profile GET resolves PAN/Aadhaar
    // with `employees` as the PRIMARY source and employee_statutory_info only as
    // a fallback when that primary is empty — so without this write, an approved
    // change to someone who already has a PAN on file never becomes visible
    // anywhere.
    const conn = makeConnection(PENDING_REQUEST);
    getConnection.mockResolvedValue(conn);

    const res = await request(app())
      .patch(`/api/statutory-change-requests/${APPROVAL_ID}`)
      .send({ decision: "approved" });

    expect(res.status).toBe(200);
    expect(encryptAadhaarForSync).toHaveBeenCalledWith("999988887777", expect.any(String));
    expect(blindIndexAadhaar).toHaveBeenCalledWith("999988887777", expect.any(String));

    const panSync = conn.statements.findIndex((s) => s.includes("UPDATE employees SET pan_number"));
    expect(panSync).toBeGreaterThan(-1);
    expect(conn.params[panSync]).toContain("NEWPP5678B");
    expect(conn.params[panSync]).toContain("enc(NEWPP5678B)");
    expect(conn.params[panSync]).toContain("idx(NEWPP5678B)");

    const aadhaarSync = conn.statements.findIndex((s) => s.includes("UPDATE employees SET aadhaar_number"));
    expect(aadhaarSync).toBeGreaterThan(-1);
    expect(conn.params[aadhaarSync]).toContain("999988887777");
    expect(conn.params[aadhaarSync]).toContain("aenc(999988887777)");
    expect(conn.params[aadhaarSync]).toContain("aidx(999988887777)");
  });

  it("commits before writing the audit log, and masks PAN/Aadhaar/UAN in it", async () => {
    const conn = makeConnection(PENDING_REQUEST);
    getConnection.mockResolvedValue(conn);

    await request(app())
      .patch(`/api/statutory-change-requests/${APPROVAL_ID}`)
      .send({ decision: "approved" });

    expect(logSensitiveAction).toHaveBeenCalledTimes(1);
    const entry = logSensitiveAction.mock.calls[0][0];
    expect(entry.action_type).toBe("STATUTORY_DETAILS_APPROVED");
    expect(entry.employee_id).toBe(EMPLOYEE_ID);
    expect(JSON.stringify(entry.new_value_json)).not.toContain("NEWPP5678B");
    expect(JSON.stringify(entry.new_value_json)).not.toContain("999988887777");
    expect(entry.new_value_json.pan_number).toBe("******678B"); // "NEWPP5678B" masked to last 4
  });

  it("masks a nested old_values shape ({ employees: {...}, employee_statutory_info: {...} })", async () => {
    // submitStatutoryDetailsForApproval (profile-approval.service.ts) now stores
    // old_values nested like this instead of the flat shape / literal '{}' it
    // used to write. maskStatutoryValues must recurse into it, or PAN/Aadhaar
    // would be written unmasked into the audit log for the first time.
    const conn = makeConnection({
      ...PENDING_REQUEST,
      old_values: JSON.stringify({
        employees: { pan_number: "OLDPP1234A", aadhaar_number: "111122223333" },
        employee_statutory_info: { pan_number: "OLDPP1234A", aadhaar_id: "111122223333" },
      }),
    });
    getConnection.mockResolvedValue(conn);

    await request(app())
      .patch(`/api/statutory-change-requests/${APPROVAL_ID}`)
      .send({ decision: "approved" });

    const entry = logSensitiveAction.mock.calls[0][0];
    const serialized = JSON.stringify(entry.old_value_json);
    expect(serialized).not.toContain("OLDPP1234A");
    expect(serialized).not.toContain("111122223333");
    expect(entry.old_value_json.employees.pan_number).toBe("******234A");
    expect(entry.old_value_json.employee_statutory_info.aadhaar_id).toBe("********3333");
  });

  it("rejects with a reason, does not touch employee_statutory_info", async () => {
    const conn = makeConnection(PENDING_REQUEST);
    getConnection.mockResolvedValue(conn);

    const res = await request(app())
      .patch(`/api/statutory-change-requests/${APPROVAL_ID}`)
      .send({ decision: "rejected", note: "PAN card scan illegible" });

    expect(res.status).toBe(200);
    expect(conn.statements.some((s) => s.includes("INSERT INTO employee_statutory_info"))).toBe(false);
    expect(logSensitiveAction.mock.calls[0][0].action_type).toBe("STATUTORY_DETAILS_REJECTED");
    expect(logSensitiveAction.mock.calls[0][0].reason).toBe("PAN card scan illegible");
  });

  it("refuses to re-process an already-decided request (409), rolls back, no audit log", async () => {
    const conn = makeConnection({ ...PENDING_REQUEST, status: "approved" });
    getConnection.mockResolvedValue(conn);

    const res = await request(app())
      .patch(`/api/statutory-change-requests/${APPROVAL_ID}`)
      .send({ decision: "approved" });

    expect(res.status).toBe(409);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(logSensitiveAction).not.toHaveBeenCalled();
  });

  it("404s when the request doesn't exist, rolls back", async () => {
    const conn = makeConnection(null);
    getConnection.mockResolvedValue(conn);

    const res = await request(app())
      .patch(`/api/statutory-change-requests/${APPROVAL_ID}`)
      .send({ decision: "approved" });

    expect(res.status).toBe(404);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("always releases the connection, even on error", async () => {
    const conn = makeConnection(PENDING_REQUEST);
    getConnection.mockResolvedValue(conn);

    await request(app()).patch(`/api/statutory-change-requests/${APPROVAL_ID}`).send({ decision: "approved" });

    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("rejects an approval carrying a malformed PAN, rolls back, never writes or audits", async () => {
    const conn = makeConnection({
      ...PENDING_REQUEST,
      new_values: JSON.stringify({ ...JSON.parse(PENDING_REQUEST.new_values), pan_number: "NOT-A-PAN" }),
    });
    getConnection.mockResolvedValue(conn);

    const res = await request(app())
      .patch(`/api/statutory-change-requests/${APPROVAL_ID}`)
      .send({ decision: "approved" });

    expect(res.status).toBe(400);
    expect(res.body.details.some((d: any) => d.field === "pan_number")).toBe(true);
    expect(conn.statements.some((s) => s.includes("INSERT INTO employee_statutory_info"))).toBe(false);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(logSensitiveAction).not.toHaveBeenCalled();
  });

  it("rejects an approval carrying a malformed Aadhaar", async () => {
    const conn = makeConnection({
      ...PENDING_REQUEST,
      new_values: JSON.stringify({ ...JSON.parse(PENDING_REQUEST.new_values), aadhaar_id: "123" }),
    });
    getConnection.mockResolvedValue(conn);

    const res = await request(app())
      .patch(`/api/statutory-change-requests/${APPROVAL_ID}`)
      .send({ decision: "approved" });

    expect(res.status).toBe(400);
    expect(res.body.details.some((d: any) => d.field === "aadhaar_id")).toBe(true);
  });
});
