/**
 * profile_update_approval's only unique key is its own id PK (a fresh
 * randomUUID() every submit call), so the INSERT ... ON DUPLICATE KEY UPDATE
 * in both submitBankDetailsForApproval and submitStatutoryDetailsForApproval
 * could never actually fire — a second submission while one is already
 * pending always inserted a brand-new row instead of replacing it, so
 * conflicting pending requests stacked up unbounded. The UI tells the
 * employee "New requests will replace the pending one" (ProfileSensitiveDetails.tsx),
 * which was false.
 *
 * Fix: look up an existing pending row for the same employee + request_type
 * first, and reuse its id when one exists, so ON DUPLICATE KEY UPDATE
 * actually replaces it instead of the insert silently always creating new.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { dbExecute, logSensitiveAction, sendSMS } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  logSensitiveAction: vi.fn(),
  sendSMS: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));
vi.mock("../../communication/sms.helper.js", () => ({ sendSMS }));
vi.mock("../../../shared/fieldEncryption.js", () => ({ encryptField: vi.fn((v: string) => `enc(${v})`) }));

const { profileApprovalService, submitStatutoryDetailsForApproval } = await import("../profile-approval.service.js");

const EMPLOYEE_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const EXISTING_PENDING_ID = "33333333-3333-3333-3333-333333333333";

describe("submitBankDetailsForApproval — pending-request dedup", () => {
  beforeEach(() => {
    dbExecute.mockReset();
    logSensitiveAction.mockReset().mockResolvedValue(undefined);
    sendSMS.mockReset().mockResolvedValue(undefined);
  });

  it("reuses the existing pending row's id instead of inserting a new one", async () => {
    dbExecute
      .mockResolvedValueOnce([[{ id: EXISTING_PENDING_ID, old_values: {} }]]) // SELECT existing pending
      .mockResolvedValueOnce([{}])  // INSERT bank_penny_drop_log
      .mockResolvedValueOnce([{}])  // INSERT ... ON DUPLICATE KEY UPDATE profile_update_approval
      .mockResolvedValueOnce([[]]); // SELECT employee for SMS (empty -> no SMS)

    const result = await profileApprovalService.submitBankDetailsForApproval(
      USER_ID,
      EMPLOYEE_ID,
      { bank_name: "New Bank", account_number: "123456789012" },
    );

    expect(result.id).toBe(EXISTING_PENDING_ID);

    const insertCall = dbExecute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO profile_update_approval"));
    expect(insertCall).toBeTruthy();
    expect(insertCall![1][0]).toBe(EXISTING_PENDING_ID); // id param reused, not a fresh UUID
  });

  it("generates a fresh id when no pending request exists for this employee", async () => {
    dbExecute
      .mockResolvedValueOnce([[]])  // SELECT existing pending — none
      .mockResolvedValueOnce([{}])  // INSERT bank_penny_drop_log
      .mockResolvedValueOnce([{}])  // INSERT profile_update_approval
      .mockResolvedValueOnce([[]]); // SELECT employee for SMS

    const result = await profileApprovalService.submitBankDetailsForApproval(
      USER_ID,
      EMPLOYEE_ID,
      { bank_name: "New Bank", account_number: "123456789012" },
    );

    expect(result.id).not.toBe(EXISTING_PENDING_ID);
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });
});

describe("submitStatutoryDetailsForApproval — pending-request dedup", () => {
  beforeEach(() => {
    dbExecute.mockReset();
    logSensitiveAction.mockReset().mockResolvedValue(undefined);
  });

  it("reuses the existing pending row's id instead of inserting a new one", async () => {
    dbExecute
      .mockResolvedValueOnce([[{ id: EXISTING_PENDING_ID }]]) // SELECT existing pending (findPendingApprovalId)
      .mockResolvedValueOnce([{}]);                             // INSERT ... ON DUPLICATE KEY UPDATE

    const result = await submitStatutoryDetailsForApproval(USER_ID, EMPLOYEE_ID, { pan_number: "ABCDE1234F" });

    expect(result.id).toBe(EXISTING_PENDING_ID);
    const insertCall = dbExecute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO profile_update_approval"));
    expect(insertCall![1][0]).toBe(EXISTING_PENDING_ID);
  });

  it("generates a fresh id when no pending statutory request exists", async () => {
    dbExecute
      .mockResolvedValueOnce([[]])  // SELECT existing pending — none
      .mockResolvedValueOnce([{}]); // INSERT

    const result = await submitStatutoryDetailsForApproval(USER_ID, EMPLOYEE_ID, { pan_number: "ABCDE1234F" });

    expect(result.id).not.toBe(EXISTING_PENDING_ID);
  });

  it("bank and statutory dedup lookups are scoped independently by request_type", async () => {
    dbExecute
      .mockResolvedValueOnce([[]])  // SELECT pending statutory_details — none, even if a bank one is pending
      .mockResolvedValueOnce([{}]);

    await submitStatutoryDetailsForApproval(USER_ID, EMPLOYEE_ID, { pan_number: "ABCDE1234F" });

    const selectCall = dbExecute.mock.calls[0];
    expect(String(selectCall[0])).toContain("request_type = ?");
    expect(selectCall[1]).toEqual([EMPLOYEE_ID, "statutory_details"]);
  });
});
