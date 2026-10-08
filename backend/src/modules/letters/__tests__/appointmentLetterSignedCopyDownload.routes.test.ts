/**
 * HR download of an issued letter, through Express: the company-signed original
 * (default, unchanged) and the employee-signed copy (?copy=accepted).
 *
 * The database is a mock; the files are real, in a temp directory standing in for
 * the appointment-letter storage root, so path validation and the sha256 check run
 * against actual bytes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";

const state = vi.hoisted(() => ({ root: "" }));
let userRoles: string[] = ["hr"];
let inScope = true;
let issueRow: Record<string, unknown> | null = null;
let txRows: Array<Record<string, unknown>> = [];
let listRows: Array<Record<string, unknown>> = [];
const audit = vi.fn(async (..._args: unknown[]) => undefined);
const executed: Array<{ sql: string; params: unknown[] }> = [];

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: "hr-1" };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => (_req: express.Request, res: express.Response, next: express.NextFunction) =>
    roles.some((r) => userRoles.includes(r)) ? next() : res.status(403).json({ success: false, message: "Forbidden" }),
}));
vi.mock("../../../shared/scopeAccess.js", () => ({
  buildScopeWhereClause: vi.fn(async () => ({ sql: "e.branch_id = ?", params: ["b1"] })),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      executed.push({ sql, params });
      if (sql.includes("has_accepted_copy")) return [listRows];
      if (sql.includes("FROM appointment_letter_esign_transaction") && sql.includes("WHERE issue_id")) return [txRows];
      if (sql.includes("FROM appointment_letter_issue i")) return [inScope && issueRow ? [issueRow] : []];
      return [[]];
    }),
  },
}));
vi.mock("../appointmentLetterEsign.service.js", () => ({ appointmentLetterStorageRoot: () => state.root }));
vi.mock("../appointmentLetterAudit.js", () => ({ auditAppointmentLetter: (...a: unknown[]) => audit(...a) }));
vi.mock("../appointmentLetterResend.service.js", () => ({
  resendAppointmentAcceptLink: vi.fn(), getAppointmentResendOptions: vi.fn(), checkAppointmentEsignStatus: vi.fn(),
}));
vi.mock("../appointmentLetterEligibility.service.js", () => ({
  appointmentLetterSearchTerm: (s: string) => `%${s}%`, evaluateAppointmentLetterEligibility: vi.fn(), listAppointmentLetterQueue: vi.fn(),
}));
vi.mock("../appointmentLetterIssue.service.js", () => ({ issueAppointmentLetter: vi.fn(), revokeAppointmentLetter: vi.fn() }));
vi.mock("../appointmentLetterPdf.service.js", () => ({ renderAppointmentLetterPdf: vi.fn() }));
vi.mock("../../org/branchAddress.service.js", () => ({
  resolveEmployeeLetterhead: vi.fn(), assertPrintableLetterhead: vi.fn(), EMPTY_LETTERHEAD: {},
}));
vi.mock("../appointmentLetterData.service.js", () => ({ resolveAppointmentLetterSalary: vi.fn() }));

const { appointmentLetterRouter } = await import("../appointmentLetter.routes.js");

const app = express();
app.use(express.json());
app.use("/letters", appointmentLetterRouter);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, message: err.message });
});

const ORIGINAL = Buffer.from("%PDF-1.4 company-signed original");
const ACCEPTED = Buffer.from("%PDF-1.4 employee-signed copy");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const URL = "/letters/appointment-letters/issue-1/download";

const binary = (r: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on("data", (c: Buffer) => chunks.push(c));
  r.on("end", () => cb(null, Buffer.concat(chunks)));
};

let originalPath = "";
let acceptedPath = "";
let outsidePath = "";
let outsideDir = "";

beforeAll(() => {
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), "al-storage-"));
  fs.mkdirSync(path.join(state.root, "emp-1"), { recursive: true });
  originalPath = path.join(state.root, "emp-1", "MCN-AL-1.pdf");
  acceptedPath = path.join(state.root, "emp-1", "MCN-AL-1-accepted.pdf");
  fs.writeFileSync(originalPath, ORIGINAL);
  fs.writeFileSync(acceptedPath, ACCEPTED);
  outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "al-outside-"));
  outsidePath = path.join(outsideDir, "secret.pdf");
  fs.writeFileSync(outsidePath, "not yours");
});
afterAll(() => {
  fs.rmSync(state.root, { recursive: true, force: true });
  fs.rmSync(outsideDir, { recursive: true, force: true });
});

const signedTx = (over: Record<string, unknown> = {}) => ({
  id: "tx-9", signed_file_path: acceptedPath, signed_file_sha256: sha(ACCEPTED), completed_at: "2026-09-24T05:30:00.000Z", ...over,
});

beforeEach(() => {
  userRoles = ["hr"];
  inScope = true;
  issueRow = { letter_number: "MCN-AL-1", signed_file_path: originalPath };
  txRows = [signedTx()];
  listRows = [];
  executed.length = 0;
  audit.mockClear();
});

describe("GET download — original (default) is unchanged", () => {
  it("streams the company-signed file with no copy param", async () => {
    const res = await request(app).get(URL).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, ORIGINAL)).toBe(0);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="MCN-AL-1.pdf"');
    // The original path never consults the eSign transaction table.
    expect(executed.some((q) => q.sql.includes("appointment_letter_esign_transaction"))).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it("copy=original is the same as no param, and ?inline=1 renders inline", async () => {
    const res = await request(app).get(`${URL}?copy=original&inline=1`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe('inline; filename="MCN-AL-1.pdf"');
  });

  it("still 404s with the re-issue message when the original is missing on disk", async () => {
    issueRow = { letter_number: "MCN-AL-1", signed_file_path: path.join(state.root, "gone.pdf") };
    const res = await request(app).get(URL);
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not on disk/);
  });

  it("rejects an unknown copy value instead of guessing", async () => {
    const res = await request(app).get(`${URL}?copy=everything`);
    expect(res.status).toBe(400);
  });
});

describe("GET download?copy=accepted", () => {
  it("streams the employee-signed copy as <letterNumber>-accepted.pdf", async () => {
    const res = await request(app).get(`${URL}?copy=accepted`).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, ACCEPTED)).toBe(0);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="MCN-AL-1-accepted.pdf"');
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("supports ?inline=1", async () => {
    const res = await request(app).get(`${URL}?copy=accepted&inline=1`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe('inline; filename="MCN-AL-1-accepted.pdf"');
  });

  it("asks for the NEWEST signed transaction that holds a file", async () => {
    await request(app).get(`${URL}?copy=accepted`);
    const q = executed.find((e) => e.sql.includes("FROM appointment_letter_esign_transaction"))!;
    expect(q.sql).toMatch(/status = 'signed'/);
    expect(q.sql).toMatch(/signed_file_path IS NOT NULL/);
    expect(q.sql).toMatch(/ORDER BY completed_at DESC/);
    expect(q.params).toEqual(["issue-1"]);
  });

  it("is audited as a view of the signed copy", async () => {
    await request(app).get(`${URL}?copy=accepted`);
    expect(audit).toHaveBeenCalledWith("issue-1", "SIGNED_COPY_VIEWED", "hr-1", { transactionId: "tx-9", inline: false });
  });

  it("404s with a clear message when no signed transaction exists", async () => {
    txRows = [];
    const res = await request(app).get(`${URL}?copy=accepted`);
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/no employee-signed copy yet/);
    expect(res.body.code).toBe("ACCEPTED_COPY_MISSING");
  });

  it("404s (does not fall back to the original) when the signed file is gone from disk", async () => {
    txRows = [signedTx({ signed_file_path: path.join(state.root, "emp-1", "vanished.pdf") })];
    const res = await request(app).get(`${URL}?copy=accepted`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ACCEPTED_COPY_MISSING");
  });

  it.each([
    ["a traversal path", () => path.join(state.root, "..", path.basename(outsideDir), "secret.pdf")],
    ["an absolute path elsewhere", () => outsidePath],
    ["the storage root itself", () => state.root],
  ])("refuses %s and never reads it", async (_l, mk) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    txRows = [signedTx({ signed_file_path: mk(), signed_file_sha256: null })];
    const res = await request(app).get(`${URL}?copy=accepted`);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("not yours");
    expect(res.body.message).not.toContain(outsideDir);
    warn.mockRestore();
  });

  it("refuses with 409 when the bytes no longer match the recorded sha256, and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    txRows = [signedTx({ signed_file_sha256: sha(Buffer.from("something else")) })];
    const res = await request(app).get(`${URL}?copy=accepted`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ACCEPTED_COPY_INTEGRITY");
    expect(res.text).not.toContain("employee-signed copy");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("integrity check"));
    expect(audit).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("serves a copy that has no recorded hash (older rows) rather than blocking HR", async () => {
    txRows = [signedTx({ signed_file_sha256: null })];
    const res = await request(app).get(`${URL}?copy=accepted`);
    expect(res.status).toBe(200);
  });
});

describe("authorization and row scope are the same for both copies", () => {
  it.each(["original", "accepted"])("403s a role outside VIEW_ROLES (%s)", async (copy) => {
    userRoles = ["employee"];
    const res = await request(app).get(`${URL}?copy=${copy}`);
    expect(res.status).toBe(403);
  });

  it("admits branch_head, which is a view-only role", async () => {
    userRoles = ["branch_head"];
    const res = await request(app).get(`${URL}?copy=accepted`);
    expect(res.status).toBe(200);
  });

  it.each(["original", "accepted"])("404s an out-of-scope letter without reading any signed copy (%s)", async (copy) => {
    inScope = false;
    const res = await request(app).get(`${URL}?copy=${copy}`);
    expect(res.status).toBe(404);
    expect(executed.some((q) => q.sql.includes("appointment_letter_esign_transaction"))).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it("scopes the lookup by branch in SQL, as the original download always did", async () => {
    await request(app).get(`${URL}?copy=accepted`);
    const lookup = executed.find((e) => e.sql.includes("i.letter_number, i.signed_file_path"))!;
    expect(lookup.sql).toContain("e.branch_id = ?");
    expect(lookup.params).toEqual(["issue-1", "b1"]);
  });
});

describe("GET /appointment-letters (issued list) payload", () => {
  it("selects the esign fields and computes has_accepted_copy / accepted_copy_sha256 from the transaction table", async () => {
    listRows = [
      { id: "i1", letter_number: "MCN-AL-1", employee_esign_status: "signed", employee_esign_at: "2026-09-24T05:30:00.000Z", has_accepted_copy: 1, accepted_copy_sha256: "ab".repeat(32) },
      { id: "i2", letter_number: "MCN-AL-2", employee_esign_status: "sent", employee_esign_at: null, has_accepted_copy: 0, accepted_copy_sha256: null },
    ];
    const res = await request(app).get("/letters/appointment-letters");
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ employee_esign_status: "signed", has_accepted_copy: true });
    expect(res.body.data[1]).toMatchObject({ employee_esign_status: "sent", employee_esign_at: null, has_accepted_copy: false });
    expect(typeof res.body.data[0].has_accepted_copy).toBe("boolean");
    const q = executed.find((e) => e.sql.includes("has_accepted_copy"))!;
    expect(q.sql).toContain("i.employee_esign_status");
    expect(q.sql).toContain("i.employee_esign_at");
    expect(q.sql).toMatch(/EXISTS \(SELECT 1 FROM appointment_letter_esign_transaction/);
    expect(q.sql).toMatch(/t\.status = 'signed' AND t\.signed_file_path IS NOT NULL/);
    // Branch scope is still applied to the list.
    expect(q.sql).toContain("e.branch_id = ?");
  });
});
