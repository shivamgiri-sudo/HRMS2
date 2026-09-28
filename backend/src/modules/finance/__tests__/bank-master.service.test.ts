import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { bankMasterService, BankMasterError } from "../bank-master.service.js";

beforeEach(() => execute.mockReset());

describe("bankMasterService.create", () => {
  it("refuses an empty bank name", async () => {
    await expect(bankMasterService.create({ bankName: "  ", bankCode: null, ifscPrefix: null })).rejects.toThrow(BankMasterError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("uppercases and validates the IFSC prefix format (4 letters)", async () => {
    await expect(bankMasterService.create({ bankName: "Test Bank", bankCode: null, ifscPrefix: "abc" }))
      .rejects.toThrow(/IFSC prefix/i);
  });

  it("creates a bank with a valid, uppercased IFSC prefix", async () => {
    execute.mockResolvedValueOnce([{}]);
    const result = await bankMasterService.create({ bankName: "Test Bank", bankCode: "TB", ifscPrefix: "tbnk" });
    expect(result.id).toBeTruthy();
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO bank_master/), expect.arrayContaining(["Test Bank", "TB", "TBNK"]));
  });

  it("surfaces a duplicate bank name as a clear 409-style error, not a raw DB error", async () => {
    execute.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }));
    await expect(bankMasterService.create({ bankName: "HDFC Bank", bankCode: null, ifscPrefix: null }))
      .rejects.toThrow(/already exists/i);
  });
});

describe("bankMasterService.update", () => {
  it("refuses an invalid IFSC prefix on update too", async () => {
    await expect(bankMasterService.update("bank-1", { ifscPrefix: "12345" })).rejects.toThrow(/IFSC prefix/i);
  });

  it("throws a not-found error when no row is affected", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 0 }]);
    await expect(bankMasterService.update("bank-1", { bankName: "New Name" })).rejects.toThrow(/not found/i);
  });

  it("updates successfully when a row is affected", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await expect(bankMasterService.update("bank-1", { activeStatus: false })).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bank_master/), expect.arrayContaining([0, "bank-1"]));
  });
});

describe("bankMasterService.delete", () => {
  beforeEach(() => { execute.mockReset(); });

  it("throws 404 when the bank does not exist", async () => {
    execute.mockResolvedValueOnce([[]]); // SELECT returns empty array
    await expect(bankMasterService.delete("bm-missing")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 409 when a company_bank_account references this bank", async () => {
    execute.mockResolvedValueOnce([[{ id: "bm-1", bank_name: "SBI" }]]); // bank exists
    execute.mockResolvedValueOnce([[{ cnt: 2 }]]); // references found
    await expect(bankMasterService.delete("bm-1")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("hard-deletes the bank when no account references it", async () => {
    execute.mockResolvedValueOnce([[{ id: "bm-2", bank_name: "HDFC" }]]); // bank exists
    execute.mockResolvedValueOnce([[{ cnt: 0 }]]); // no references
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]); // DELETE succeeds
    await expect(bankMasterService.delete("bm-2")).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM bank_master/), ["bm-2"]);
  });
});
