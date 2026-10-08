/**
 * The employee-facing appointment-letter accept endpoints (session / file / token
 * resolution).
 *
 * The properties that matter, and are tested rather than assumed:
 *  1. Both tokens work. The accept token (new letters, resends) and — only while a
 *     letter has no accept token — the verification token, which is what the
 *     already-emailed links carry.
 *  2. Nothing is enumerable: unknown and malformed tokens are one flat 404, and a
 *     malformed token never reaches SQL.
 *  3. A revoked letter is served nothing.
 *  4. No salary, contact detail, internal id or file path ever leaves in the
 *     session payload.
 *  5. The PDF endpoint only serves files from the appointment-letter store.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "appt-public-"));
vi.spyOn(process, "cwd").mockReturnValue(TMP);
const STORE = path.join(TMP, "private-storage", "appointment-letters");

const state: {
  letter?: Record<string, unknown>;
  accepted?: { signed_file_path: string };
  calls: Array<{ sql: string; params: unknown[] }>;
} = { calls: [] };

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const text = String(sql);
      state.calls.push({ sql: text, params });
      if (text.includes("FROM appointment_letter_issue")) return [state.letter ? [state.letter] : []];
      if (text.includes("FROM appointment_letter_esign_transaction")) return [state.accepted ? [state.accepted] : []];
      return [[]];
    }),
  },
}));
vi.mock("../../../config/env.js", () => ({ env: { LUCKPAY_PROVIDER_ENABLED: true, FRONTEND_URL: "https://hrms.test" } }));

const syncMock = vi.fn(async () => ({ synced: false, state: "pending" as const }));
const startMock = vi.fn();
vi.mock("../appointmentLetterEsign.service.js", () => ({
  appointmentLetterStorageRoot: () => path.resolve(process.cwd(), "private-storage", "appointment-letters"),
  syncAppointmentEsignForIssue: (...args: unknown[]) => syncMock(...(args as [])),
  startAppointmentEsign: (...args: unknown[]) => startMock(...args),
}));

const {
  resolveLetterByToken, getPublicLetterSession, getPublicLetterFile, startPublicLetterEsign,
} = await import("../appointmentLetterPublic.service.js");

const TOKEN = "a1".repeat(24);
const baseLetter = () => ({
  id: "issue-1",
  letter_number: "MCN-AL-2026-000123",
  employee_id: "emp-1",
  employee_name: "HARSH TALWAR",
  employee_code: "MAS60616",
  designation: "EXECUTIVE",
  branch_name: "NOIDA-2",
  date_of_joining: new Date("2025-09-25T18:30:00Z"),
  company_signed_at: new Date("2025-10-06T06:00:00Z"),
  signed_by_name: "Authorised Signatory",
  employee_esign_status: "not_sent",
  employee_esign_at: null,
  signed_file_path: path.join(STORE, "emp-1", "MCN-AL-2026-000123.pdf"),
  file_sha256: null,
  status: "issued",
  revoked_at: null,
  // Things that must never leave the server:
  salary_snapshot_json: JSON.stringify({ gross: 50000, ctc: 600000 }),
  personal_email: "harsh@example.com",
  verify_token_hash: "deadbeef",
});

function writeLetterPdf(rel = path.join("emp-1", "MCN-AL-2026-000123.pdf")) {
  const p = path.join(STORE, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "%PDF-1.7 test");
  return p;
}

beforeEach(() => {
  state.letter = undefined;
  state.accepted = undefined;
  state.calls = [];
  syncMock.mockClear();
  startMock.mockReset();
});
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("token resolution — both tokens, never the raw value", () => {
  it("looks the letter up by the SHA-256 of the token, for the accept hash and the legacy verify hash", async () => {
    state.letter = baseLetter();
    await resolveLetterByToken(TOKEN);
    const call = state.calls.find((c) => c.sql.includes("FROM appointment_letter_issue"))!;
    expect(call.params).toEqual([sha256(TOKEN), sha256(TOKEN)]);
    expect(call.params).not.toContain(TOKEN);
    // accept token always; verify token ONLY while the letter has no accept token.
    expect(call.sql.replace(/\s+/g, " ")).toContain(
      "accept_token_hash = ? OR (accept_token_hash IS NULL AND verify_token_hash = ?)",
    );
  });

  it("an unknown token is a flat 404 with the generic message", async () => {
    await expect(resolveLetterByToken(TOKEN)).rejects.toMatchObject({
      statusCode: 404, code: "LETTER_LINK_INVALID",
    });
  });

  it("malformed tokens never reach the database", async () => {
    for (const bad of ["", "short", "x".repeat(200), "has spaces in it 1234567890", "../../etc/passwd/../x", undefined as unknown as string]) {
      await expect(resolveLetterByToken(bad)).rejects.toMatchObject({ statusCode: 404, code: "LETTER_LINK_INVALID" });
    }
    expect(state.calls).toHaveLength(0);
  });

  it("an unknown token and a malformed token get the identical message (no enumeration signal)", async () => {
    const unknown = await resolveLetterByToken(TOKEN).catch((e: Error) => e.message);
    const malformed = await resolveLetterByToken("nope").catch((e: Error) => e.message);
    expect(unknown).toBe(malformed);
  });

  it.each([
    ["status", { status: "revoked" }],
    ["revoked_at", { revoked_at: new Date() }],
  ])("a revoked letter (%s) answers 410 and nothing is served", async (_label, patch) => {
    state.letter = { ...baseLetter(), ...patch };
    await expect(resolveLetterByToken(TOKEN)).rejects.toMatchObject({ statusCode: 410, code: "LETTER_REVOKED" });
    await expect(getPublicLetterSession(TOKEN)).rejects.toMatchObject({ statusCode: 410 });
    await expect(getPublicLetterFile(TOKEN)).rejects.toMatchObject({ statusCode: 410 });
    await expect(startPublicLetterEsign({ token: TOKEN })).rejects.toMatchObject({ statusCode: 410 });
    expect(startMock).not.toHaveBeenCalled();
  });
});

describe("session payload", () => {
  it("returns only what the signer needs to know what they are accepting", async () => {
    state.letter = baseLetter();
    const session = await getPublicLetterSession(TOKEN);
    expect(Object.keys(session).sort()).toEqual([
      "branchName", "companySignedAt", "companySignedBy", "dateOfJoining", "designation", "employeeCode",
      "employeeName", "esignAvailable", "esignStatus", "letterNumber", "signed", "signedAt",
    ]);
    expect(session).toMatchObject({
      letterNumber: "MCN-AL-2026-000123", employeeName: "HARSH TALWAR", designation: "EXECUTIVE",
      branchName: "NOIDA-2", dateOfJoining: "26 Sep 2025", esignStatus: "not_sent", signed: false, esignAvailable: true,
    });
  });

  it("never leaks salary, contact details, internal ids, hashes or file paths", async () => {
    state.letter = baseLetter();
    const json = JSON.stringify(await getPublicLetterSession(TOKEN));
    for (const secret of ["50000", "600000", "gross", "salary", "harsh@example.com", "emp-1", "issue-1", "deadbeef", "private-storage", ".pdf"]) {
      expect(json, `session must not contain ${secret}`).not.toContain(secret);
    }
    // ...and the query does not even fetch the salary snapshot or the contact columns.
    const select = state.calls.find((c) => c.sql.includes("FROM appointment_letter_issue"))!.sql;
    expect(select).not.toMatch(/salary_snapshot_json|personal_email|official_email/);
  });

  it("refreshes a pending signature from the provider (throttled) and re-reads if it changed", async () => {
    state.letter = { ...baseLetter(), employee_esign_status: "sent" };
    syncMock.mockResolvedValueOnce({ synced: true, state: "completed" as const, changed: true } as never);
    state.calls = [];
    await getPublicLetterSession(TOKEN);
    expect(syncMock).toHaveBeenCalledTimes(1);
    const [issueId, opts] = syncMock.mock.calls[0] as unknown as [string, { minIntervalSeconds: number; timeoutMs: number }];
    expect(issueId).toBe("issue-1");
    expect(opts.minIntervalSeconds).toBeGreaterThanOrEqual(60);
    expect(opts.timeoutMs).toBeLessThanOrEqual(10_000);
    expect(state.calls.filter((c) => c.sql.includes("FROM appointment_letter_issue"))).toHaveLength(2);
  });

  it.each(["not_sent", "signed"])("does not call the provider for a %s letter", async (status) => {
    state.letter = { ...baseLetter(), employee_esign_status: status };
    await getPublicLetterSession(TOKEN);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("a provider failure during the refresh never fails the page", async () => {
    state.letter = { ...baseLetter(), employee_esign_status: "opened" };
    syncMock.mockRejectedValueOnce(new Error("provider down"));
    await expect(getPublicLetterSession(TOKEN)).resolves.toMatchObject({ esignStatus: "opened", signed: false });
  });

  it("reports a signed letter with its signing time", async () => {
    state.letter = { ...baseLetter(), employee_esign_status: "signed", employee_esign_at: new Date("2026-09-24T05:00:00Z") };
    const session = await getPublicLetterSession(TOKEN);
    expect(session.signed).toBe(true);
    expect(session.signedAt).toBe("2026-09-24T05:00:00.000Z");
  });
});

describe("file endpoint guards", () => {
  it("serves the company-signed letter from the appointment-letter store", async () => {
    state.letter = baseLetter();
    const expected = writeLetterPdf();
    const file = await getPublicLetterFile(TOKEN);
    expect(file.storagePath).toBe(expected);
    expect(file.fileName).toBe("MCN-AL-2026-000123.pdf");
  });

  it("refuses a path that resolves outside the store, even when the row says so", async () => {
    const outside = path.join(TMP, "secret.txt");
    fs.writeFileSync(outside, "nope");
    state.letter = { ...baseLetter(), signed_file_path: outside };
    await expect(getPublicLetterFile(TOKEN)).rejects.toMatchObject({ statusCode: 404, code: "LETTER_FILE_MISSING" });

    state.letter = { ...baseLetter(), signed_file_path: path.join(STORE, "..", "..", "secret.txt") };
    await expect(getPublicLetterFile(TOKEN)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("answers a clear 404 when the row outlives its file", async () => {
    state.letter = { ...baseLetter(), signed_file_path: path.join(STORE, "emp-1", "gone.pdf") };
    await expect(getPublicLetterFile(TOKEN)).rejects.toMatchObject({ statusCode: 404, code: "LETTER_FILE_MISSING" });
  });

  it("serves the employee's own signed copy once they have signed", async () => {
    writeLetterPdf();
    const accepted = writeLetterPdf(path.join("emp-1", "MCN-AL-2026-000123-accepted.pdf"));
    state.letter = { ...baseLetter(), employee_esign_status: "signed" };
    state.accepted = { signed_file_path: accepted };
    const file = await getPublicLetterFile(TOKEN);
    expect(file.storagePath).toBe(accepted);
    expect(file.fileName).toBe("MCN-AL-2026-000123-accepted.pdf");
  });

  it("does not look for an accepted copy before the employee has signed", async () => {
    writeLetterPdf();
    state.letter = baseLetter();
    state.accepted = { signed_file_path: path.join(STORE, "emp-1", "MCN-AL-2026-000123-accepted.pdf") };
    state.calls = [];
    await getPublicLetterFile(TOKEN);
    expect(state.calls.some((c) => c.sql.includes("appointment_letter_esign_transaction"))).toBe(false);
  });
});

describe("start", () => {
  it("resolves the token, then delegates with only the letter facts and the client context", async () => {
    state.letter = baseLetter();
    startMock.mockResolvedValue({ code: "OK", providerUrl: "https://provider.test/x", esignStatus: "sent", alreadySigned: false, message: null });
    const out = await startPublicLetterEsign({ token: TOKEN, ipAddress: "1.2.3.4", userAgent: "UA" });
    expect(out.providerUrl).toBe("https://provider.test/x");
    const [letter, ctx] = startMock.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(letter).toMatchObject({ id: "issue-1", letterNumber: "MCN-AL-2026-000123", employeeId: "emp-1" });
    expect(ctx).toEqual({ ipAddress: "1.2.3.4", userAgent: "UA" });
    expect(JSON.stringify(letter)).not.toContain("50000");
  });

  it("an unknown token never starts a provider session", async () => {
    await expect(startPublicLetterEsign({ token: TOKEN })).rejects.toMatchObject({ statusCode: 404 });
    expect(startMock).not.toHaveBeenCalled();
  });
});
