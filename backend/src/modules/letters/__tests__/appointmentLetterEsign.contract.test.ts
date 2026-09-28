/**
 * The employee's Aadhaar eSign of an issued appointment letter: session creation
 * (start), completion (sync) and the reconciliation entry points.
 *
 * Every provider call is billed, so the properties tested here are mostly about NOT
 * calling it: a live session is reused, concurrent clicks converge on one session,
 * and a failed call is not retried under the same id. The provider client and the
 * database are mocked; nothing here reaches a real provider or a real DB.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "appt-esign-"));
vi.spyOn(process, "cwd").mockReturnValue(TMP);
const STORE = path.join(TMP, "private-storage", "appointment-letters");

type Call = { sql: string; params: unknown[] };
const calls: Call[] = [];
const connCalls: Call[] = [];
const script: {
  open: Array<Record<string, unknown> | undefined>;   // successive answers for the "open transaction" lookup
  insertError: unknown;
  recentProviderError: boolean;
  letterStatus: string;
  syncRow: Record<string, unknown> | undefined;
  dueRows: Array<{ issue_id: string }>;
  byClientTxn: { issue_id: string } | undefined;
} = { open: [], insertError: null, recentProviderError: false, letterStatus: "not_sent", syncRow: undefined, dueRows: [], byClientTxn: undefined };

const conn = {
  beginTransaction: vi.fn(async () => undefined),
  commit: vi.fn(async () => undefined),
  rollback: vi.fn(async () => undefined),
  release: vi.fn(),
  execute: vi.fn(async (sql: string, params: unknown[] = []) => { connCalls.push({ sql: String(sql), params }); return [{ affectedRows: 1 }]; }),
};

vi.mock("../../../db/mysql.js", () => ({
  db: {
    getConnection: vi.fn(async () => conn),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const text = String(sql).replace(/\s+/g, " ");
      calls.push({ sql: text, params });
      if (text.includes("WHERE issue_id = ? AND open_marker = 'Y'")) return [[script.open.length > 1 ? script.open.shift() : script.open[0]].filter(Boolean)];
      if (text.startsWith("INSERT INTO appointment_letter_esign_transaction")) {
        if (script.insertError) throw script.insertError;
        return [{ affectedRows: 1 }];
      }
      if (text.includes("status = 'provider_error' AND updated_at")) return [script.recentProviderError ? [{ hit: 1 }] : []];
      if (text.startsWith("SELECT employee_esign_status FROM appointment_letter_issue")) return [[{ employee_esign_status: script.letterStatus }]];
      if (text.includes("FROM appointment_letter_esign_transaction t JOIN appointment_letter_issue i")) return [script.syncRow ? [script.syncRow] : []];
      if (text.includes("SELECT issue_id FROM appointment_letter_esign_transaction WHERE provider = ? AND client_transaction_id")) return [script.byClientTxn ? [script.byClientTxn] : []];
      if (text.includes("SELECT issue_id FROM appointment_letter_esign_transaction WHERE id = ?")) return [[{ issue_id: "issue-1" }]];
      if (text.includes("SELECT issue_id FROM appointment_letter_esign_transaction WHERE provider = ? AND ((open_marker")) return [script.dueRows];
      return [{ affectedRows: 1 }];
    }),
  },
}));
const envMock = { LUCKPAY_PROVIDER_ENABLED: true };
vi.mock("../../../config/env.js", () => ({ env: envMock }));
vi.mock("../appointmentLetterAudit.js", () => ({
  auditAppointmentLetter: vi.fn(async (issueId: string | null, action: string, actor: string | null, detail: unknown) => {
    audits.push({ issueId, action, actor, detail });
  }),
}));
const audits: Array<{ issueId: string | null; action: string; actor: string | null; detail: unknown }> = [];

const esignWithUrl = vi.fn();
const checkESignStatus = vi.fn();
const downloadESignDocument = vi.fn();
vi.mock("../../integrations/luckpay/luckpay.client.js", () => ({
  luckpayClient: {
    generateClientTransactionId: (prefix: string) => `${prefix}-fixed-id`,
    checkESignStatus: (...a: unknown[]) => checkESignStatus(...a),
    downloadESignDocument: (...a: unknown[]) => downloadESignDocument(...a),
  },
  esignWithUrl: (...a: unknown[]) => esignWithUrl(...a),
}));

const {
  startAppointmentEsign, syncAppointmentEsignForIssue, reconcileAppointmentEsigns,
  findIssueIdByClientTransaction, syncAppointmentEsignByClientTransaction,
} = await import("../appointmentLetterEsign.service.js");

const PDF_BYTES = Buffer.from("%PDF-1.7 company signed");
const PDF_PATH = path.join(STORE, "emp-1", "MCN-AL-2026-000123.pdf");
fs.mkdirSync(path.dirname(PDF_PATH), { recursive: true });
fs.writeFileSync(PDF_PATH, PDF_BYTES);

const letter = (over: Record<string, unknown> = {}) => ({
  id: "issue-1", letterNumber: "MCN-AL-2026-000123", employeeId: "emp-1", employeeName: "HARSH TALWAR",
  branchName: "NOIDA-2", signedFilePath: PDF_PATH,
  fileSha256: createHash("sha256").update(PDF_BYTES).digest("hex"), esignStatus: "not_sent", ...over,
});
const openTx = (over: Record<string, unknown> = {}) => ({
  id: "tx-1", status: "initiated", provider_url: "https://provider.test/session/1",
  provider_reference_id: "ref-1", client_transaction_id: "appointment-letter-fixed-id", age_s: 30, ...over,
});
const syncRow = (over: Record<string, unknown> = {}) => ({
  id: "tx-1", employee_id: "emp-1", client_transaction_id: "appointment-letter-fixed-id",
  provider_reference_id: "ref-1", status: "initiated", signed_file_path: null, poll_attempts: 0,
  since_poll_s: null, letter_number: "MCN-AL-2026-000123", employee_name: "HARSH TALWAR", candidate_id: null, ...over,
});
const sqlOf = (list: Call[]) => list.map((c) => c.sql);
const wrote = (needle: string) => sqlOf(calls).some((s) => s.includes(needle));

beforeEach(() => {
  calls.length = 0; connCalls.length = 0; audits.length = 0;
  Object.assign(script, { open: [], insertError: null, recentProviderError: false, letterStatus: "not_sent", syncRow: undefined, dueRows: [], byClientTxn: undefined });
  envMock.LUCKPAY_PROVIDER_ENABLED = true;
  esignWithUrl.mockReset(); checkESignStatus.mockReset(); downloadESignDocument.mockReset();
  conn.beginTransaction.mockClear(); conn.commit.mockClear(); conn.rollback.mockClear(); conn.release.mockClear();
});
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("start — never pays for a session it already has", () => {
  it("an already-signed letter starts nothing", async () => {
    const out = await startAppointmentEsign(letter({ esignStatus: "signed" }), {});
    expect(out).toMatchObject({ code: "ALREADY_SIGNED", alreadySigned: true, providerUrl: null });
    expect(esignWithUrl).not.toHaveBeenCalled();
  });

  it("provider switched off: a friendly refusal, no provider call, no row", async () => {
    envMock.LUCKPAY_PROVIDER_ENABLED = false;
    const out = await startAppointmentEsign(letter(), {});
    expect(out.code).toBe("PROVIDER_UNAVAILABLE");
    expect(out.message).toMatch(/contact HR/i);
    expect(esignWithUrl).not.toHaveBeenCalled();
    expect(wrote("INSERT INTO appointment_letter_esign_transaction")).toBe(false);
  });

  it("creates ONE session through the shared provider client with the company-signed PDF", async () => {
    esignWithUrl.mockResolvedValue({ providerUrl: "https://provider.test/new", providerReferenceId: "ref-9", status: "Initiated" });
    const out = await startAppointmentEsign(letter(), { ipAddress: "1.2.3.4", userAgent: "UA" });

    expect(out).toMatchObject({ code: "OK", providerUrl: "https://provider.test/new", esignStatus: "sent" });
    expect(esignWithUrl).toHaveBeenCalledTimes(1);
    expect(esignWithUrl.mock.calls[0][0]).toMatchObject({
      filePath: PDF_PATH, clientTransactionId: "appointment-letter-fixed-id",
      signedBy: "HARSH TALWAR", location: "NOIDA-2",
    });
    // The row is claimed BEFORE the provider is called (that is what serialises concurrent clicks)...
    const insertAt = sqlOf(calls).findIndex((s) => s.startsWith("INSERT INTO appointment_letter_esign_transaction"));
    const updateAt = sqlOf(calls).findIndex((s) => s.startsWith("UPDATE appointment_letter_esign_transaction SET provider_reference_id"));
    expect(insertAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(insertAt);
    expect(calls[insertAt].sql).toContain("'initiating', 'Y'");
    // ...and the letter moves to 'sent' pointing at the transaction.
    const issueUpdate = calls.find((c) => c.sql.includes("SET employee_esign_status = 'sent', esign_transaction_id = ?"))!;
    expect(issueUpdate.sql).toContain("NOT IN ('signed', 'completed')");
    expect(audits.map((a) => a.action)).toContain("ESIGN_STARTED");
  });

  it("is idempotent: repeated clicks reuse the live session and never call the provider", async () => {
    script.open = [openTx()];
    script.letterStatus = "sent";
    // The pre-flight status check is throttled (polled 10s ago), so it does not bill either.
    script.syncRow = syncRow({ since_poll_s: 10 });

    const first = await startAppointmentEsign(letter({ esignStatus: "sent" }), {});
    const second = await startAppointmentEsign(letter({ esignStatus: "opened" }), {});

    expect(first).toMatchObject({ code: "OK", providerUrl: "https://provider.test/session/1" });
    expect(second.providerUrl).toBe(first.providerUrl);
    expect(esignWithUrl).not.toHaveBeenCalled();
    expect(checkESignStatus).not.toHaveBeenCalled();
    expect(wrote("INSERT INTO appointment_letter_esign_transaction")).toBe(false);
    expect(audits.filter((a) => a.action === "ESIGN_OPENED")).toHaveLength(2);
    expect(calls.some((c) => c.sql.includes("SET employee_esign_status = 'opened'") && c.sql.includes("employee_esign_status = 'sent'"))).toBe(true);
  });

  it("a second click while the first is still creating the session is told to wait — no second provider call", async () => {
    script.open = [openTx({ status: "initiating", provider_url: null, age_s: 3 })];
    const out = await startAppointmentEsign(letter(), {});
    expect(out).toMatchObject({ code: "PREPARING", providerUrl: null });
    expect(out.retryAfterSeconds).toBeGreaterThan(0);
    expect(esignWithUrl).not.toHaveBeenCalled();
  });

  it("concurrent creation: the loser of the UNIQUE(issue_id, open_marker) race converges on the winner's session", async () => {
    script.open = [undefined, openTx({ provider_url: "https://provider.test/winner" })];
    script.insertError = Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY", errno: 1062 });
    script.syncRow = syncRow({ since_poll_s: 5 });
    script.letterStatus = "sent";
    const out = await startAppointmentEsign(letter(), {});
    expect(out).toMatchObject({ code: "OK", providerUrl: "https://provider.test/winner" });
    expect(esignWithUrl).not.toHaveBeenCalled();
  });

  it("a request that died mid-creation (stale 'initiating') is closed and replaced", async () => {
    script.open = [openTx({ status: "initiating", provider_url: null, age_s: 900 }), undefined];
    esignWithUrl.mockResolvedValue({ providerUrl: "https://provider.test/fresh", providerReferenceId: "ref-2", status: "initiated" });
    const out = await startAppointmentEsign(letter(), {});
    expect(out).toMatchObject({ code: "OK", providerUrl: "https://provider.test/fresh" });
    expect(calls.some((c) => c.sql.includes("SET status = ?, open_marker = NULL") && c.params[0] === "abandoned_unresolved")).toBe(true);
  });

  it("an expired provider session is closed at the provider check and a new one is created (restart allowed)", async () => {
    script.open = [openTx(), undefined];
    script.syncRow = syncRow({ since_poll_s: null });
    checkESignStatus.mockResolvedValue({ state: "expired", providerStatus: "EXPIRED", sanitized: {}, message: "expired" });
    esignWithUrl.mockResolvedValue({ providerUrl: "https://provider.test/restart", providerReferenceId: "ref-3", status: "initiated" });
    script.letterStatus = "expired";

    const out = await startAppointmentEsign(letter({ esignStatus: "sent" }), {});

    expect(out).toMatchObject({ code: "OK", providerUrl: "https://provider.test/restart" });
    expect(wrote("SET status = 'expired', open_marker = NULL")).toBe(true);
    expect(esignWithUrl).toHaveBeenCalledTimes(1);
    expect(audits.map((a) => a.action)).toContain("ESIGN_EXPIRED");
  });

  it("the employee having already signed at the provider is discovered before a URL is handed out", async () => {
    script.open = [openTx()];
    script.syncRow = syncRow({ since_poll_s: null });
    checkESignStatus.mockResolvedValue({ state: "completed", providerStatus: "SIGNED", sanitized: {} });
    downloadESignDocument.mockResolvedValue({ buffer: Buffer.from("%PDF signed by employee") });
    script.letterStatus = "signed";
    const out = await startAppointmentEsign(letter({ esignStatus: "sent" }), {});
    expect(out).toMatchObject({ code: "ALREADY_SIGNED", alreadySigned: true, providerUrl: null });
    expect(esignWithUrl).not.toHaveBeenCalled();
  });

  it("a provider failure closes the session as provider_error, tells the employee kindly, and leaves the letter status alone", async () => {
    esignWithUrl.mockRejectedValue(new Error("eSign provider timed out after 30 s"));
    const out = await startAppointmentEsign(letter(), {});
    expect(out.code).toBe("PROVIDER_ERROR");
    expect(out.providerUrl).toBeNull();
    expect(out.message).not.toMatch(/timed out|provider timed/i); // internals stay out of the employee's view
    expect(calls.some((c) => c.sql.includes("SET status = ?, open_marker = NULL") && c.params[0] === "provider_error")).toBe(true);
    expect(wrote("SET employee_esign_status = 'sent'")).toBe(false);
    expect(audits.map((a) => a.action)).toContain("ESIGN_PROVIDER_FAILED");
  });

  it("a provider that answers without a signing URL is treated as a failure, not a dead link", async () => {
    esignWithUrl.mockResolvedValue({ providerUrl: null, providerReferenceId: "ref", status: "initiated" });
    const out = await startAppointmentEsign(letter(), {});
    expect(out).toMatchObject({ code: "PROVIDER_ERROR", providerUrl: null });
    expect(wrote("SET employee_esign_status = 'sent'")).toBe(false);
  });

  it("after a failed provider call, clicks inside the cooldown do not pay for another attempt", async () => {
    script.recentProviderError = true;
    const out = await startAppointmentEsign(letter(), {});
    expect(out.code).toBe("COOLDOWN");
    expect(esignWithUrl).not.toHaveBeenCalled();
  });

  it("refuses to send a letter whose stored PDF no longer matches the hash the company signed", async () => {
    const out = await startAppointmentEsign(letter({ fileSha256: "0".repeat(64) }), {});
    expect(out.code).toBe("DOCUMENT_UNAVAILABLE");
    expect(esignWithUrl).not.toHaveBeenCalled();
    expect(wrote("INSERT INTO appointment_letter_esign_transaction")).toBe(false);
    expect(audits.map((a) => a.action)).toContain("ESIGN_FILE_UNAVAILABLE");
  });

  it("refuses when the PDF is missing from disk", async () => {
    const out = await startAppointmentEsign(letter({ signedFilePath: path.join(STORE, "emp-1", "missing.pdf"), fileSha256: null }), {});
    expect(out.code).toBe("DOCUMENT_UNAVAILABLE");
    expect(esignWithUrl).not.toHaveBeenCalled();
  });
});

describe("sync — marking the letter signed", () => {
  it("records the signature, keeps the employee-signed copy, and never touches the company-signed original", async () => {
    script.syncRow = syncRow();
    checkESignStatus.mockResolvedValue({ state: "completed", providerStatus: "SIGNED", sanitized: { ok: true } });
    const signedBytes = Buffer.from("%PDF-1.7 signed by employee");
    downloadESignDocument.mockResolvedValue({ buffer: signedBytes });

    const out = await syncAppointmentEsignForIssue("issue-1");

    expect(out).toMatchObject({ synced: true, state: "completed", changed: true });
    expect(checkESignStatus).toHaveBeenCalledWith({ clientTransactionId: "appointment-letter-fixed-id", transactionId: "ref-1" });
    // The provider's own identifiers are what download uses, never our primary key.
    expect(downloadESignDocument).toHaveBeenCalledWith({ clientTransactionId: "appointment-letter-fixed-id", transactionId: "ref-1" });

    const accepted = path.join(STORE, "emp-1", "MCN-AL-2026-000123-accepted.pdf");
    expect(fs.readFileSync(accepted)).toEqual(signedBytes);
    expect(fs.readFileSync(PDF_PATH)).toEqual(PDF_BYTES); // original untouched

    // Both writes sit inside one transaction.
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    const txUpdate = connCalls[0];
    expect(txUpdate.sql.replace(/\s+/g, " ")).toContain("SET status = 'signed', open_marker = NULL");
    expect(txUpdate.params[0]).toBe(accepted);
    expect(txUpdate.params[1]).toBe(createHash("sha256").update(signedBytes).digest("hex"));
    const issueUpdate = connCalls[1].sql.replace(/\s+/g, " ");
    expect(issueUpdate).toContain("employee_esign_status = 'signed'");
    expect(issueUpdate).toContain("employee_esign_at = COALESCE(employee_esign_at, NOW())");

    expect(audits.map((a) => a.action)).toContain("EMPLOYEE_SIGNED");
    // Signer-identity check row (alert-only) is written for the appointment_letter scope.
    const identity = calls.find((c) => c.sql.includes("INSERT INTO esign_signer_identity_check"))!;
    expect(identity.sql).toContain("'appointment_letter'");
  });

  it("a confirmed signature whose download failed is still recorded as signed, and healed later", async () => {
    script.syncRow = syncRow();
    checkESignStatus.mockResolvedValue({ state: "completed", providerStatus: "SIGNED", sanitized: {} });
    downloadESignDocument.mockRejectedValue(new Error("download 500"));
    const out = await syncAppointmentEsignForIssue("issue-1");
    expect(out.state).toBe("completed");
    expect(connCalls[0].params[0]).toBeNull();               // no file yet
    expect(connCalls[1].sql).toContain("employee_esign_status = 'signed'");
    expect(calls.some((c) => c.sql.includes("INSERT INTO esign_signer_identity_check"))).toBe(false);

    // Next pass: provider already confirmed, only the artefact is fetched — no status call.
    checkESignStatus.mockClear();
    downloadESignDocument.mockResolvedValue({ buffer: Buffer.from("%PDF healed") });
    script.syncRow = syncRow({ status: "signed", signed_file_path: null });
    connCalls.length = 0; audits.length = 0;
    await syncAppointmentEsignForIssue("issue-1");
    expect(checkESignStatus).not.toHaveBeenCalled();
    expect(connCalls[0].params[0]).toContain("MCN-AL-2026-000123-accepted.pdf");
    expect(audits.map((a) => a.action)).not.toContain("EMPLOYEE_SIGNED"); // first completion only
  });

  it("a pending signature is recorded as pending and the session stays open", async () => {
    script.syncRow = syncRow();
    checkESignStatus.mockResolvedValue({ state: "pending", providerStatus: "PENDING", sanitized: {}, message: null });
    const out = await syncAppointmentEsignForIssue("issue-1");
    expect(out).toMatchObject({ synced: true, state: "pending" });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(calls.some((c) => c.sql.includes("open_marker = NULL"))).toBe(false);
  });

  it("a provider FAILED is recoverable: recorded, session not closed", async () => {
    script.syncRow = syncRow();
    checkESignStatus.mockResolvedValue({ state: "failed", providerStatus: "FAILED", sanitized: {}, message: "otp failed" });
    const out = await syncAppointmentEsignForIssue("issue-1");
    expect(out.state).toBe("failed");
    expect(calls.some((c) => c.sql.includes("open_marker = NULL"))).toBe(false);
    expect(calls.some((c) => c.sql.includes("employee_esign_status = 'expired'"))).toBe(false);
  });

  it("a status-check error is reported, not thrown, and recorded on the row", async () => {
    script.syncRow = syncRow();
    checkESignStatus.mockRejectedValue(new Error("network down"));
    const out = await syncAppointmentEsignForIssue("issue-1");
    expect(out).toMatchObject({ synced: false, state: "pending", message: "network down" });
    expect(calls.some((c) => c.sql.includes("SET error_message = ?") && c.params[0] === "network down")).toBe(true);
  });

  it("a page view cannot turn into a polling loop: a recent check is skipped without a provider call", async () => {
    script.syncRow = syncRow({ since_poll_s: 30 });
    const out = await syncAppointmentEsignForIssue("issue-1", { minIntervalSeconds: 120 });
    expect(out.synced).toBe(false);
    expect(checkESignStatus).not.toHaveBeenCalled();
    expect(calls.some((c) => c.sql.includes("poll_attempts = ?"))).toBe(false);
  });

  it("records the check BEFORE calling the provider, so a concurrent caller backs off", async () => {
    script.syncRow = syncRow();
    checkESignStatus.mockImplementation(async () => {
      expect(wrote("SET poll_attempts = ?, last_polled_at = NOW()")).toBe(true);
      return { state: "pending", providerStatus: "PENDING", sanitized: {} };
    });
    await syncAppointmentEsignForIssue("issue-1");
    expect(checkESignStatus).toHaveBeenCalledTimes(1);
  });

  it("nothing to sync when the letter has no live session", async () => {
    const out = await syncAppointmentEsignForIssue("issue-1");
    expect(out).toMatchObject({ synced: false, state: "not_started" });
    expect(checkESignStatus).not.toHaveBeenCalled();
  });

  it("a session whose provider reference is not yet recorded is not polled", async () => {
    script.syncRow = syncRow({ provider_reference_id: null });
    const out = await syncAppointmentEsignForIssue("issue-1");
    expect(out.state).toBe("not_started");
    expect(checkESignStatus).not.toHaveBeenCalled();
  });
});

describe("mapping a provider transaction back to a letter (shared status sync / webhook / worker)", () => {
  it("finds the letter by client transaction id, scoped to the provider", async () => {
    script.byClientTxn = { issue_id: "issue-1" };
    expect(await findIssueIdByClientTransaction("appointment-letter-fixed-id")).toBe("issue-1");
    const q = calls.find((c) => c.sql.includes("client_transaction_id = ?"))!;
    expect(q.params).toEqual(["luckpay", "appointment-letter-fixed-id"]);
  });

  it("returns null for anything that is not an appointment-letter transaction, so callers keep their own answer", async () => {
    expect(await findIssueIdByClientTransaction("joining-kit-abc")).toBeNull();
    expect(await findIssueIdByClientTransaction("")).toBeNull();
    expect(await syncAppointmentEsignByClientTransaction("joining-kit-abc")).toBeNull();
    expect(checkESignStatus).not.toHaveBeenCalled();
  });

  it("syncs through the same path when it is an appointment-letter transaction", async () => {
    script.byClientTxn = { issue_id: "issue-1" };
    script.syncRow = syncRow();
    checkESignStatus.mockResolvedValue({ state: "completed", providerStatus: "SIGNED", sanitized: {} });
    downloadESignDocument.mockResolvedValue({ buffer: Buffer.from("%PDF x") });
    const out = await syncAppointmentEsignByClientTransaction("appointment-letter-fixed-id");
    expect(out).toMatchObject({ state: "completed" });
  });
});

describe("reconcile — the scheduled pull", () => {
  it("polls each due letter once, with its own small batch, and counts completions", async () => {
    script.dueRows = [{ issue_id: "issue-1" }, { issue_id: "issue-2" }];
    script.syncRow = syncRow();
    checkESignStatus.mockResolvedValue({ state: "completed", providerStatus: "SIGNED", sanitized: {} });
    downloadESignDocument.mockResolvedValue({ buffer: Buffer.from("%PDF x") });
    const out = await reconcileAppointmentEsigns();
    expect(out).toEqual({ examined: 2, completed: 2, errors: 0 });
    const select = calls.find((c) => c.sql.includes("SELECT issue_id FROM appointment_letter_esign_transaction WHERE provider = ? AND ((open_marker"))!;
    expect(select.sql).toMatch(/LIMIT 10$/);
    expect(select.sql).toContain("next_poll_at IS NULL OR next_poll_at <= NOW()");
    expect(select.sql).toContain("INTERVAL 14 DAY");
  });

  it("one letter's failure does not stop the rest", async () => {
    script.dueRows = [{ issue_id: "issue-1" }, { issue_id: "issue-2" }];
    script.syncRow = syncRow();
    let n = 0;
    checkESignStatus.mockImplementation(async () => {
      n += 1;
      if (n === 1) throw new Error("boom");
      return { state: "pending", providerStatus: "PENDING", sanitized: {} };
    });
    const out = await reconcileAppointmentEsigns();
    // The first is absorbed by the sync's own error handling (reported, not thrown).
    expect(out.examined).toBe(2);
    expect(out.errors).toBe(0);
    expect(checkESignStatus).toHaveBeenCalledTimes(2);
  });
});
