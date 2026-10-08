import { beforeEach, describe, expect, it, vi } from "vitest";

const { post } = vi.hoisted(() => ({ post: vi.fn().mockResolvedValue({ journalEntryId: "je-1" }) }));
vi.mock("../journal.service.js", () => ({ journalService: { post } }));

import { postGrnApprovalJournalEntry } from "../grn-journal-posting.service.js";

function mockConnection(subHeadRow: any, imprestRow?: any) {
  return {
    execute: vi.fn(async (sql: string) => {
      if (/finance_expense_sub_head_master/.test(sql)) return [subHeadRow ? [subHeadRow] : []];
      if (/payable_account_master/.test(sql)) return [imprestRow ? [imprestRow] : []];
      return [[]];
    }),
  } as any;
}

const VENDOR_GRN = {
  id: "grn-1",
  grn_type: "vendor" as const,
  grn_number: "GRN/HQ/202609/0012",
  head: "Repairs & Maintenance",
  sub_head: "AC Servicing",
  vendor_id: "vendor-acme",
  amount: 5000,
  amount_with_tax: 5900,
};

const IMPREST_GRN = {
  id: "grn-2",
  grn_type: "imprest" as const,
  grn_number: "GRN/HQ/202609/0013",
  head: "Staff Welfare",
  sub_head: "Tea, Coffee & Refreshment",
  vendor_id: null,
  amount: 1000,
  amount_with_tax: null,
};

beforeEach(() => { post.mockClear(); });

describe("postGrnApprovalJournalEntry — vendor GRN", () => {
  it("posts Dr expense_sub_head / Cr vendor at the gross (amount_with_tax) figure", async () => {
    const conn = mockConnection({ id: "sh-ac-servicing" });
    await postGrnApprovalJournalEntry(conn, VENDOR_GRN, "finance-head-1");

    expect(post).toHaveBeenCalledTimes(1);
    const call = post.mock.calls[0][1];
    expect(call.sourceType).toBe("grn");
    expect(call.sourceId).toBe("grn-1");
    expect(call.lines).toEqual([
      { accountType: "expense_sub_head", accountId: "sh-ac-servicing", debitAmount: 5900 },
      { accountType: "vendor", accountId: "vendor-acme", creditAmount: 5900 },
    ]);
  });

  it("falls back to amount when amount_with_tax is not set", async () => {
    const conn = mockConnection({ id: "sh-ac-servicing" });
    await postGrnApprovalJournalEntry(conn, { ...VENDOR_GRN, amount_with_tax: null }, "finance-head-1");
    const call = post.mock.calls[0][1];
    expect(call.lines[0].debitAmount).toBe(5000);
  });

  it("refuses with EXPENSE_LEDGER_NOT_FOUND when the head/sub-head has no active ledger master row", async () => {
    const conn = mockConnection(null);
    await expect(postGrnApprovalJournalEntry(conn, VENDOR_GRN, "finance-head-1")).rejects.toMatchObject({
      code: "EXPENSE_LEDGER_NOT_FOUND",
      statusCode: 422,
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("refuses with GRN_VENDOR_MISSING when a vendor GRN has no vendor_id", async () => {
    const conn = mockConnection({ id: "sh-ac-servicing" });
    await expect(
      postGrnApprovalJournalEntry(conn, { ...VENDOR_GRN, vendor_id: null }, "finance-head-1"),
    ).rejects.toMatchObject({ code: "GRN_VENDOR_MISSING" });
    expect(post).not.toHaveBeenCalled();
  });
});

describe("postGrnApprovalJournalEntry — imprest GRN", () => {
  it("posts Dr expense_sub_head / Cr Imprest Float (payable_account) instead of a vendor", async () => {
    const conn = mockConnection({ id: "sh-tea-coffee" }, { id: "pam-imprest-float" });
    await postGrnApprovalJournalEntry(conn, IMPREST_GRN, "finance-head-1");

    const call = post.mock.calls[0][1];
    expect(call.lines).toEqual([
      { accountType: "expense_sub_head", accountId: "sh-tea-coffee", debitAmount: 1000 },
      { accountType: "payable_account", accountId: "pam-imprest-float", creditAmount: 1000 },
    ]);
  });

  it("refuses with IMPREST_FLOAT_ACCOUNT_NOT_FOUND if the seeded 'Imprest Float' row is missing", async () => {
    const conn = mockConnection({ id: "sh-tea-coffee" }, null);
    await expect(postGrnApprovalJournalEntry(conn, IMPREST_GRN, "finance-head-1")).rejects.toMatchObject({
      code: "IMPREST_FLOAT_ACCOUNT_NOT_FOUND",
    });
  });
});
