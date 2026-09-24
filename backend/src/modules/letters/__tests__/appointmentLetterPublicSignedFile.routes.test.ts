/**
 * GET /api/public/appointment-letter/:token/signed-file — the employee's own
 * "Download your signed letter" button, through Express with the real service.
 *
 * Bearer-token gated like /file: a valid token whose letter has been signed gets
 * the employee-signed copy; everything else is refused, and nothing is ever
 * cached. The DB is a mock; the files are real bytes in a temp storage root.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "appt-public-signed-"));
const STORE = path.join(TMP, "private-storage", "appointment-letters");
const state: {
  letter?: Record<string, unknown>;
  txRows: Array<Record<string, unknown>>;
  calls: Array<{ sql: string; params: unknown[] }>;
} = { txRows: [], calls: [] };

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const text = String(sql);
      state.calls.push({ sql: text, params });
      if (text.includes("FROM appointment_letter_issue")) return [state.letter ? [state.letter] : []];
      if (text.includes("FROM appointment_letter_esign_transaction")) return [state.txRows];
      return [[]];
    }),
  },
}));
vi.mock("../../../config/env.js", () => ({ env: { LUCKPAY_PROVIDER_ENABLED: true, FRONTEND_URL: "https://hrms.test" } }));
vi.mock("../appointmentLetterEsign.service.js", () => ({
  appointmentLetterStorageRoot: () => STORE,
  syncAppointmentEsignForIssue: vi.fn(async () => ({ changed: false })),
  startAppointmentEsign: vi.fn(),
}));

const { publicAppointmentLetterRouter } = await import("../appointmentLetterPublic.routes.js");

const app = express();
app.use("/api/public/appointment-letter", publicAppointmentLetterRouter);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, message: err.message });
});

const TOKEN = "b2".repeat(24);
const ORIGINAL = Buffer.from("%PDF company-signed original");
const ACCEPTED = Buffer.from("%PDF employee-signed copy");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const acceptedPath = path.join(STORE, "emp-1", "MCN-AL-2026-000002-accepted.pdf");
const originalPath = path.join(STORE, "emp-1", "MCN-AL-2026-000002.pdf");

fs.mkdirSync(path.join(STORE, "emp-1"), { recursive: true });
fs.writeFileSync(acceptedPath, ACCEPTED);
fs.writeFileSync(originalPath, ORIGINAL);
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const letter = (over: Record<string, unknown> = {}) => ({
  id: "issue-2", letter_number: "MCN-AL-2026-000002", employee_id: "emp-1", employee_name: "A B", employee_code: "MAS1",
  designation: "EXECUTIVE", branch_name: "NOIDA", date_of_joining: null, company_signed_at: null, signed_by_name: null,
  employee_esign_status: "signed", employee_esign_at: new Date("2026-09-24T05:30:00Z"),
  signed_file_path: originalPath, file_sha256: null, status: "issued", revoked_at: null, ...over,
});
const tx = (over: Record<string, unknown> = {}) => ({
  id: "tx-1", signed_file_path: acceptedPath, signed_file_sha256: sha(ACCEPTED), completed_at: new Date("2026-09-24T05:30:00Z"), ...over,
});

const URL = `/api/public/appointment-letter/${TOKEN}/signed-file`;

beforeEach(() => {
  state.letter = letter();
  state.txRows = [tx()];
  state.calls = [];
});

describe("public signed-file endpoint", () => {
  it("serves the employee-signed copy (not the original) for a valid token on a signed letter", async () => {
    const res = await request(app).get(URL).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, ACCEPTED)).toBe(0);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="MCN-AL-2026-000002-accepted.pdf"');
  });

  it("is never cached and never leaks the token in a Referer", async () => {
    const res = await request(app).get(URL);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-robots-tag"]).toContain("noindex");
  });

  it("404s when the employee has not signed yet, and never reads a file", async () => {
    state.letter = letter({ employee_esign_status: "sent", employee_esign_at: null });
    const res = await request(app).get(URL);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("LETTER_NOT_SIGNED");
    expect(state.calls.some((c) => c.sql.includes("appointment_letter_esign_transaction"))).toBe(false);
  });

  it("404s (and does NOT hand back the original) when signed but the signed file was never retrieved", async () => {
    state.txRows = [];
    const res = await request(app).get(URL);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ACCEPTED_COPY_MISSING");
    expect(res.text).not.toContain("company-signed original");
  });

  it("410s a revoked letter before touching any file", async () => {
    state.letter = letter({ status: "revoked", revoked_at: new Date() });
    const res = await request(app).get(URL);
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("LETTER_REVOKED");
    expect(state.calls.some((c) => c.sql.includes("appointment_letter_esign_transaction"))).toBe(false);
  });

  it("410s a letter whose status is revoked even if revoked_at is empty", async () => {
    state.letter = letter({ status: "revoked", revoked_at: null });
    expect((await request(app).get(URL)).status).toBe(410);
  });

  it("gives an unknown token the same flat 404 as the other public endpoints", async () => {
    state.letter = undefined;
    const res = await request(app).get(URL);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("LETTER_LINK_INVALID");
  });

  it("a malformed token never reaches SQL", async () => {
    const res = await request(app).get("/api/public/appointment-letter/short/signed-file");
    expect(res.status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });

  it("refuses a recorded path outside the storage root", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    state.txRows = [tx({ signed_file_path: path.join(TMP, "elsewhere.pdf"), signed_file_sha256: null })];
    const res = await request(app).get(URL);
    expect(res.status).toBe(404);
    warn.mockRestore();
  });

  it("refuses with 409 on a hash mismatch, in words written for the employee", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    state.txRows = [tx({ signed_file_sha256: sha(Buffer.from("tampered")) })];
    const res = await request(app).get(URL);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/contact HR/);
    expect(res.text).not.toContain(sha(ACCEPTED));
    warn.mockRestore();
  });

  it("the existing /file endpoint is untouched: still inline, still the company-signed letter before signing", async () => {
    state.letter = letter({ employee_esign_status: "not_sent", employee_esign_at: null });
    const res = await request(app).get(`/api/public/appointment-letter/${TOKEN}/file`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe('inline; filename="MCN-AL-2026-000002.pdf"');
  });
});
