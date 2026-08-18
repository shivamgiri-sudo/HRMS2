import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

let clientBillingNumberingService: typeof import("../client-billing-numbering.service.js")["clientBillingNumberingService"];
beforeAll(async () => {
  ({ clientBillingNumberingService } = await import("../client-billing-numbering.service.js"));
});

beforeEach(() => {
  execute.mockReset();
});

describe("mintProformaNumber", () => {
  it("formats as PI/<stateCode>/<n> using the atomic counter's insertId", async () => {
    execute.mockResolvedValueOnce([{ insertId: 7 }, []]);
    const result = await clientBillingNumberingService.mintProformaNumber("09");
    expect(result).toBe("PI/09/7");
  });

  it("scopes the counter row to kind='proforma', scope_key='GLOBAL'", async () => {
    execute.mockResolvedValueOnce([{ insertId: 1 }, []]);
    await clientBillingNumberingService.mintProformaNumber("09");
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO client_invoice_number_sequence/);
    expect(params).toEqual(["proforma", "GLOBAL"]);
  });
});

describe("mintBillNumber", () => {
  it("formats as <stateCode>-<NN>/<FYshort>, zero-padded below 10", async () => {
    execute.mockResolvedValueOnce([{ insertId: 7 }, []]);
    const result = await clientBillingNumberingService.mintBillNumber("09", "Mas Callnet India Pvt Ltd", "2026-27");
    expect(result).toBe("09-07/26-27");
  });

  it("does not zero-pad at or above 10", async () => {
    execute.mockResolvedValueOnce([{ insertId: 274 }, []]);
    const result = await clientBillingNumberingService.mintBillNumber("09", "Mas Callnet India Pvt Ltd", "2026-27");
    expect(result).toBe("09-274/26-27");
  });

  it("scopes the counter row to kind='bill', scope_key='<stateCode>|<companyName>|<financeYear>'", async () => {
    execute.mockResolvedValueOnce([{ insertId: 1 }, []]);
    await clientBillingNumberingService.mintBillNumber("09", "Mas Callnet India Pvt Ltd", "2026-27");
    const [, params] = execute.mock.calls[0];
    expect(params).toEqual(["bill", "09|Mas Callnet India Pvt Ltd|2026-27"]);
  });
});
