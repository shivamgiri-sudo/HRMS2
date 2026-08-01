/**
 * Public verification of an appointment letter.
 *
 * A bank, landlord or next employer scans the QR on a letter handed to them and
 * gets a yes/no plus the minimum needed to identify the holder. Two properties
 * matter and are tested here rather than assumed:
 *
 *  1. It discloses nothing sensitive. Salary, address, Aadhaar and PAN must
 *     never appear on a page anyone with the link can open.
 *  2. It cannot be enumerated. Lookup is by an opaque token stored as a hash,
 *     never by the sequential letter number.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

let row: Record<string, unknown> | undefined;
let lastSql = "";
let lastParams: unknown[] = [];

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params?: unknown[]) => {
      lastSql = String(sql); lastParams = params ?? [];
      return [row ? [row] : []];
    }),
  },
}));

const { verifyAppointmentLetter, mintVerificationToken, verificationUrl } =
  await import("../appointmentLetterVerify.service.js");

const TOKEN = "a".repeat(48);
const baseRow = {
  letter_number: "MCN-AL-2026-000123",
  employee_name: "HARSH TALWAR",
  employee_code: "MAS60616",
  designation: "EXECUTIVE",
  branch_name: "NOIDA-2",
  date_of_joining: new Date("2025-09-25T18:30:00Z"),
  issued_at: new Date("2025-10-06T06:00:00Z"),
  signed_by_name: "Authorised Signatory",
  signed_by_designation: "HR Manager",
  is_ca_issued: 1,
  employee_esign_status: "signed",
  status: "issued",
  revoked_at: null,
};

beforeEach(() => { row = undefined; lastSql = ""; lastParams = []; });

describe("token handling", () => {
  it("mints a token and stores only its hash", () => {
    const { token, tokenHash } = mintVerificationToken();
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(tokenHash).not.toBe(token);
  });

  it("looks up by the hash, never the raw token", async () => {
    row = { ...baseRow };
    await verifyAppointmentLetter(TOKEN);
    expect(lastSql).toContain("verify_token_hash = ?");
    expect(lastParams[0]).toBe(createHash("sha256").update(TOKEN).digest("hex"));
    expect(lastParams[0]).not.toBe(TOKEN);
  });

  it("never queries by the guessable letter number", async () => {
    row = { ...baseRow };
    await verifyAppointmentLetter(TOKEN);
    expect(lastSql).not.toMatch(/WHERE[\s\S]*letter_number\s*=/i);
  });

  it("rejects a short token without touching the database", async () => {
    const r = await verifyAppointmentLetter("short");
    expect(r.found).toBe(false);
    expect(lastSql).toBe("");
  });

  it("builds a verification URL from the token", () => {
    expect(verificationUrl("https://mcnhrms.teammas.in/", "abc")).toBe(
      "https://mcnhrms.teammas.in/verify/appointment/abc");
  });
});

describe("what a verifier is told", () => {
  it("confirms a genuine, CA-signed, accepted letter", async () => {
    row = { ...baseRow };
    const r = await verifyAppointmentLetter(TOKEN);
    expect(r.found).toBe(true);
    if (!r.found) return;
    expect(r.valid).toBe(true);
    expect(r.letterNumber).toBe("MCN-AL-2026-000123");
    expect(r.employeeName).toBe("HARSH TALWAR");
    expect(r.employeeCode).toBe("MAS60616");
    expect(r.caIssuedSignature).toBe(true);
    expect(r.employeeAccepted).toBe(true);
    expect(r.statement).toMatch(/genuine appointment letter/i);
  });

  it("dates the letter in IST, not UTC", async () => {
    // date_of_joining is stored 2025-09-25T18:30:00Z, which is 26-09 in India —
    // the same trap that misdated the letter body.
    row = { ...baseRow };
    const r = await verifyAppointmentLetter(TOKEN);
    if (!r.found) throw new Error("expected found");
    expect(r.dateOfJoining).toBe("26 Sep 2025");
  });

  it("says plainly when the signature is self-signed", async () => {
    row = { ...baseRow, is_ca_issued: 0 };
    const r = await verifyAppointmentLetter(TOKEN);
    if (!r.found) throw new Error("expected found");
    expect(r.caIssuedSignature).toBe(false);
    expect(r.statement).toMatch(/NOT from a licensed Certifying Authority/i);
  });

  it("reports a revoked letter as not to be relied upon", async () => {
    row = { ...baseRow, status: "revoked", revoked_at: new Date("2026-01-05T06:00:00Z") };
    const r = await verifyAppointmentLetter(TOKEN);
    if (!r.found) throw new Error("expected found");
    expect(r.valid).toBe(false);
    expect(r.revoked).toBe(true);
    expect(r.statement).toMatch(/REVOKED/);
  });

  it("does not distinguish unknown from removed", async () => {
    row = undefined;
    expect((await verifyAppointmentLetter(TOKEN)).found).toBe(false);
  });
});

describe("discloses nothing sensitive", () => {
  it("returns no salary, address, Aadhaar or PAN", async () => {
    row = {
      ...baseRow,
      // Even if these were selected by mistake, they must not reach the caller.
      basic: 17000, gross_salary: 30000, ctc: 30000,
      address: "somewhere private", aadhaar_number: "1234", pan_number: "ABCDE1234F",
    };
    const r = await verifyAppointmentLetter(TOKEN);
    const json = JSON.stringify(r);
    for (const leak of ["17000", "30000", "somewhere private", "1234", "ABCDE1234F", "salary", "aadhaar", "pan_number"]) {
      expect(json.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it("selects only the disclosable columns", async () => {
    row = { ...baseRow };
    await verifyAppointmentLetter(TOKEN);
    for (const col of ["salary_snapshot_json", "signed_file_path", "esign_transaction_id", "certificate_id"]) {
      expect(lastSql).not.toContain(col);
    }
  });
});
