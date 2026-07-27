import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from "../src/db/mysql.js";
import { loadAsyncBgvTriggerContext } from "../src/modules/ats/onboarding-full.service.js";

const mockDbExecute = db.execute as ReturnType<typeof vi.fn>;

describe("loadAsyncBgvTriggerContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses live onboarding schema columns and decrypts bank account data", async () => {
    mockDbExecute
      .mockResolvedValueOnce([[
        {
          full_name: "Asha Singh",
          mobile: "9999999999",
          email: "asha@example.com",
          pan_number: "ABCDE1234F",
          aadhar_number: "123456789012",
          uan_number: "123456789012",
          date_of_birth: "1995-01-10",
          father_name: "R Singh",
          current_address: "Noida",
        },
      ], []])
      .mockResolvedValueOnce([[
        {
          account_no_encrypted: "enc-value",
          ifsc_code: "HDFC0001234",
          account_holder_name: "Asha Singh",
        },
      ], []]);

    const context = await loadAsyncBgvTriggerContext("candidate-1", (value) => value === "enc-value" ? "001122334455" : "");

    expect(mockDbExecute.mock.calls[0][0]).not.toContain("p.pan_number");
    expect(mockDbExecute.mock.calls[0][0]).not.toContain("p.aadhar_number");
    expect(mockDbExecute.mock.calls[0][0]).not.toContain("p.account_number");
    expect(mockDbExecute.mock.calls[1][0]).toContain("account_no_encrypted");
    expect(context.bank.accountNo).toBe("001122334455");
    expect(context.bank.ifscCode).toBe("HDFC0001234");
    expect(context.candidate.pan_number).toBe("ABCDE1234F");
  });

  it("keeps running when bank account decryption fails", async () => {
    mockDbExecute
      .mockResolvedValueOnce([[
        {
          full_name: "Asha Singh",
          mobile: "9999999999",
          email: "asha@example.com",
          pan_number: "ABCDE1234F",
          aadhar_number: "123456789012",
          uan_number: null,
          date_of_birth: "1995-01-10",
          father_name: "R Singh",
          current_address: "Noida",
        },
      ], []])
      .mockResolvedValueOnce([[
        {
          account_no_encrypted: "enc-value",
          ifsc_code: "HDFC0001234",
          account_holder_name: "Asha Singh",
        },
      ], []]);

    const context = await loadAsyncBgvTriggerContext("candidate-1", () => {
      throw new Error("decrypt failed");
    });

    expect(context.bank.accountNo).toBeNull();
    expect(context.bank.ifscCode).toBe("HDFC0001234");
  });

  it("falls back to ats_candidate encrypted bank data when bank detail encryption is missing", async () => {
    mockDbExecute
      .mockResolvedValueOnce([[
        {
          full_name: "Asha Singh",
          mobile: "9999999999",
          email: "asha@example.com",
          pan_number: "ABCDE1234F",
          aadhar_number: "123456789012",
          uan_number: "123456789012",
          date_of_birth: "1995-01-10",
          father_name: "R Singh",
          current_address: "Noida",
          bank_ifsc: "SBIN0010177",
          bank_account_no_encrypted: "candidate-enc",
        },
      ], []])
      .mockResolvedValueOnce([[
        {
          account_no_encrypted: null,
          ifsc_code: "SBIN0010177",
          account_holder_name: "Asha Singh",
        },
      ], []]);

    const context = await loadAsyncBgvTriggerContext("candidate-1", (value) => value === "candidate-enc" ? "998877665544" : "");

    expect(context.bank.accountNo).toBe("998877665544");
    expect(context.bank.ifscCode).toBe("SBIN0010177");
  });
});
