import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Vendor payee bank details did not exist in mas_hrms OR db_bill before migration 1615
 * (verified live 2026-08-26: vendor_master 1,821 rows / tbl_vendormaster 2,059 /
 * vendor_master 526, all with zero bank columns). Introducing them introduces the
 * payment-redirection fraud vector, so these tests guard the controls, not the CRUD.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { encryptField, blindIndex } = vi.hoisted(() => ({
  encryptField: vi.fn((s: string) => `ENC(${s})`),
  blindIndex: vi.fn((s: string) => `BI(${s})`),
}));
vi.mock("../../../shared/fieldEncryption.js", () => ({ encryptField, blindIndex }));

import {
  VendorBankError,
  approveBankChange,
  getActiveBankDetail,
  rejectBankChange,
  requestBankChange,
} from "../vendor-bank.service.js";

const ACTOR = { userId: "user-maker", role: "finance_head", ip: "10.0.0.1", userAgent: "vitest" };
const CHECKER = { userId: "user-checker", role: "accounts_head", ip: "10.0.0.2", userAgent: "vitest" };
const GOOD = { accountNumber: "123456789012", ifsc: "HDFC0001234", reason: "new mandate" };

/** Every SQL string passed to db.execute, for asserting on what was written. */
const sqls = () => execute.mock.calls.map(([s]) => String(s));
const callWith = (fragment: string) =>
  execute.mock.calls.find(([s]) => String(s).includes(fragment));

beforeEach(() => {
  execute.mockReset();
  encryptField.mockClear();
  blindIndex.mockClear();
});

describe("requestBankChange", () => {
  it("stores the account number only as ciphertext plus a last-4 and blind index", async () => {
    execute.mockResolvedValueOnce([[{ id: "v1" }], []]);  // vendor exists
    execute.mockResolvedValueOnce([[], []]);              // no pending request
    execute.mockResolvedValueOnce([[], []]);              // getActiveBankDetail -> none
    execute.mockResolvedValueOnce([[], []]);              // current row -> none
    execute.mockResolvedValueOnce([{}, []]);              // INSERT request
    execute.mockResolvedValueOnce([{}, []]);              // INSERT log

    const out = await requestBankChange("v1", GOOD, ACTOR);
    expect(out.action).toBe("create");

    const [, params] = callWith("INSERT INTO vendor_bank_change_request")!;
    const p = params as unknown[];
    expect(p).toContain("ENC(123456789012)");
    expect(p).toContain("BI(123456789012)");
    expect(p).toContain("9012");   // last FOUR of 123456789012
    // The plaintext number must never reach a parameter list.
    expect(p).not.toContain("123456789012");
  });

  it("never writes vendor_bank_detail — raising is not applying", async () => {
    execute.mockResolvedValueOnce([[{ id: "v1" }], []]);
    execute.mockResolvedValueOnce([[], []]);
    execute.mockResolvedValueOnce([[], []]);
    execute.mockResolvedValueOnce([[], []]);
    execute.mockResolvedValueOnce([{}, []]);
    execute.mockResolvedValueOnce([{}, []]);

    await requestBankChange("v1", GOOD, ACTOR);

    expect(sqls().some((s) => s.includes("INSERT INTO vendor_bank_detail\n"))).toBe(false);
    expect(sqls().some((s) => s.includes("INSERT INTO vendor_bank_detail_log"))).toBe(true);
  });

  it("refuses a second pending change on the same vendor", async () => {
    execute.mockResolvedValueOnce([[{ id: "v1" }], []]);
    execute.mockResolvedValueOnce([[{ id: "existing-req" }], []]);

    await expect(requestBankChange("v1", GOOD, ACTOR)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it.each([
    ["12345", "too short"],
    ["12345678901234567890", "too long"],
    ["12345678901A", "contains a letter"],
  ])("rejects account number %s (%s)", async (accountNumber) => {
    execute.mockResolvedValueOnce([[{ id: "v1" }], []]);
    execute.mockResolvedValueOnce([[], []]);
    await expect(
      requestBankChange("v1", { ...GOOD, accountNumber }, ACTOR),
    ).rejects.toBeInstanceOf(VendorBankError);
  });

  it("rejects a malformed IFSC", async () => {
    execute.mockResolvedValueOnce([[{ id: "v1" }], []]);
    execute.mockResolvedValueOnce([[], []]);
    await expect(
      requestBankChange("v1", { ...GOOD, ifsc: "HDFC1001234" }, ACTOR),
    ).rejects.toBeInstanceOf(VendorBankError);
  });

  it("strips spaces and hyphens rather than rejecting a pasted account number", async () => {
    execute.mockResolvedValueOnce([[{ id: "v1" }], []]);
    execute.mockResolvedValueOnce([[], []]);
    execute.mockResolvedValueOnce([[], []]);
    execute.mockResolvedValueOnce([[], []]);
    execute.mockResolvedValueOnce([{}, []]);
    execute.mockResolvedValueOnce([{}, []]);

    await requestBankChange("v1", { ...GOOD, accountNumber: "1234 5678-9012" }, ACTOR);
    expect(encryptField).toHaveBeenCalledWith("123456789012");
  });
});

describe("approveBankChange — separation of duties", () => {
  const pendingReq = {
    id: "req-1", vendor_id: "v1", status: "pending", requested_by: "user-maker",
    account_number_encrypted: "ENC(123456789012)", account_number_last4: "1234",
    account_number_blind_index: "BI(123456789012)", ifsc: "HDFC0001234",
    account_holder_name: "Acme Ltd", bank_name: "HDFC", branch_name: "MG Road",
  };

  it("refuses approval by the person who raised it", async () => {
    execute.mockResolvedValueOnce([[pendingReq], []]);

    await expect(approveBankChange("req-1", ACTOR)).rejects.toMatchObject({
      statusCode: 403,
    });
    // Nothing may be written on a refused approval.
    expect(sqls().some((s) => s.includes("UPDATE vendor_bank_change_request"))).toBe(false);
    expect(sqls().some((s) => s.includes("INSERT INTO vendor_bank_detail"))).toBe(false);
  });

  it("supersedes the old account rather than updating it in place", async () => {
    execute.mockResolvedValueOnce([[pendingReq], []]);
    execute.mockResolvedValueOnce([[{ id: "old-1", account_number_last4: "9999", ifsc: "ICIC0000001" }], []]);
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);  // claim
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);  // supersede
    execute.mockResolvedValueOnce([{}, []]);                   // insert new detail
    execute.mockResolvedValueOnce([{}, []]);                   // log

    await approveBankChange("req-1", CHECKER, "verified on call");

    expect(callWith("SET status = 'superseded'")).toBeTruthy();
    expect(callWith("INSERT INTO vendor_bank_detail\n")).toBeTruthy();

    const [, logParams] = callWith("INSERT INTO vendor_bank_detail_log")!;
    // Both sides of the change are on the log row.
    expect(logParams as unknown[]).toEqual(expect.arrayContaining(["approved", "9999", "ICIC0000001", "1234"]));
  });

  it("loses the race safely when two approvers act at once", async () => {
    execute.mockResolvedValueOnce([[pendingReq], []]);
    execute.mockResolvedValueOnce([[], []]);
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]);  // someone else claimed it

    await expect(approveBankChange("req-1", CHECKER)).rejects.toMatchObject({ statusCode: 409 });
    expect(sqls().some((s) => s.includes("INSERT INTO vendor_bank_detail\n"))).toBe(false);
  });
});

describe("rejectBankChange", () => {
  it("records the requester closing their own request as cancelled, not rejected", async () => {
    execute.mockResolvedValueOnce([
      [{ vendor_id: "v1", status: "pending", requested_by: "user-maker", account_number_last4: "1234", ifsc: "HDFC0001234" }],
      [],
    ]);
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    execute.mockResolvedValueOnce([{}, []]);

    await rejectBankChange("req-1", ACTOR, "raised in error");

    const [, params] = callWith("UPDATE vendor_bank_change_request")!;
    expect((params as unknown[])[0]).toBe("cancelled");
  });

  it("records a third party's refusal as rejected, and logs the attempt", async () => {
    execute.mockResolvedValueOnce([
      [{ vendor_id: "v1", status: "pending", requested_by: "user-maker", account_number_last4: "1234", ifsc: "HDFC0001234" }],
      [],
    ]);
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    execute.mockResolvedValueOnce([{}, []]);

    await rejectBankChange("req-1", CHECKER, "could not verify");

    expect(((callWith("UPDATE vendor_bank_change_request")![1]) as unknown[])[0]).toBe("rejected");
    // A refused redirection attempt is evidence and must survive in the log.
    expect((callWith("INSERT INTO vendor_bank_detail_log")![1] as unknown[])).toContain("rejected");
  });
});

describe("getActiveBankDetail", () => {
  it("masks the account number and never selects the ciphertext column", async () => {
    execute.mockResolvedValueOnce([
      [{
        id: "d1", account_holder_name: "Acme Ltd", account_number_last4: "1234",
        ifsc: "HDFC0001234", bank_name: "HDFC", branch_name: "MG Road",
        effective_from: "2026-08-26 10:00:00",
      }],
      [],
    ]);

    const out = await getActiveBankDetail("v1");

    expect(out?.accountNumberMasked).toBe("XXXXXX1234");
    expect(sqls()[0]).not.toContain("account_number_encrypted");
  });
});

describe("route + migration contracts", () => {
  const routes = readFileSync(
    resolve(process.cwd(), "src/modules/finance/vendor-bank.routes.ts"),
    "utf8",
  );
  const migration = readFileSync(
    resolve(process.cwd(), "sql/1615_vendor_bank_details.sql"),
    "utf8",
  );

  it("gates every route to finance_head/accounts_head and never to admin", () => {
    expect(routes).toContain('const BANK_ROLES = ["finance_head", "accounts_head"] as const;');
    // hasOrgWideScope() lets `admin` past org-wide checks with no scope row, so it must
    // not appear in this router's guards at all.
    expect(routes).not.toMatch(/requireRole\([^)]*["']admin["']/);
    expect(routes).not.toMatch(/requireRole\([^)]*["']super_admin["']/);
    const guarded = routes.match(/requireRole\(\.\.\.BANK_ROLES\)/g) ?? [];
    expect(guarded.length).toBe(6);
  });

  it("creates the change log in the same migration as the detail table", () => {
    // The audit table must exist before the first account can be written, or there is a
    // window in which a bank account is set with no record of who set it.
    expect(migration).toContain("vendor_bank_detail_log");
    expect(migration).toContain("vendor_bank_change_request");
    expect(migration).toContain("vendor_bank_detail");
  });

  it("declares explicit utf8mb4_unicode_ci on every id that references vendor_master", () => {
    // A new table created under the server default collates utf8mb4_0900_ai_ci and the
    // FK to vendor_master(id) fails with errno 3780.
    const fkLines = migration
      .split("\n")
      // Column definitions only — the file's own header comment mentions CHAR(36) too.
      .filter((l) => /CHAR\(36\)/.test(l) && !l.trimStart().startsWith("--"));
    expect(fkLines.length).toBeGreaterThan(0);
    for (const line of fkLines) expect(line).toContain("utf8mb4_unicode_ci");
  });

  it("stores no plaintext account column anywhere", () => {
    expect(migration).toContain("account_number_encrypted");
    expect(migration).not.toMatch(/account_number\s+VARCHAR/i);
  });
});
