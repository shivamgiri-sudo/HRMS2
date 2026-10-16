import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({ db: { execute: h.execute, query: h.execute, getConnection: vi.fn() } }));

import { tallyVoucherService } from "../tally-voucher.service.js";

const model = {
  kind: "sales", sourceType: "invoice", sourceId: "inv-1", guid: "g-1", voucherType: "Sales", voucherNumber: "09-1/26-27",
  date: "2026-10-05", narration: "n", partyLedger: "Onfido Limited", partyGstin: null, partyStateName: null, placeOfSupply: null,
  companyGstin: "09AAACM5866H1Z6", companyStateName: null,
  entries: [
    { ledgerName: "Onfido Limited", side: "Dr", paise: 11800, role: "party" },
    { ledgerName: "Sales", side: "Cr", paise: 10000, role: "sales" },
    { ledgerName: "Output IGST", side: "Cr", paise: 1800, role: "tax" },
  ],
  display: { clientName: null, costCentreCode: null, amountPaise: 11800, taxablePaise: 10000, taxPaise: 1800 },
};

describe("renderBatchXml", () => {
  it("accepts model_json as mysql2 returns a JSON column (already an object) and as a string", async () => {
    for (const modelJson of [model, JSON.stringify(model)]) {
      h.execute.mockImplementation(async (sql: string) => {
        if (/FROM tally_voucher_batch\b(?!_line)/.test(sql)) return [[{ id: "b1", status: "validated", exception_vouchers: 0, company_name: "MAS" }], []];
        if (/FROM tally_voucher_batch_line/.test(sql)) return [[{ model_json: modelJson }], []];
        return [[], []];
      });
      const { xml, voucherCount } = await tallyVoucherService.renderBatchXml("b1", { skipExceptions: false });
      expect(voucherCount).toBe(1);
      expect(xml).toContain("<VOUCHERNUMBER>09-1/26-27</VOUCHERNUMBER>");
      expect(xml).toContain('<LEDGER NAME="Onfido Limited" ACTION="Create">');
    }
  });
});
