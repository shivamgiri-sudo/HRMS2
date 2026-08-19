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

  it("wraps the initial value in LAST_INSERT_ID so a first-ever mint for a scope returns 1, not the row's arbitrary auto-increment id", async () => {
    execute.mockResolvedValueOnce([{ insertId: 1 }, []]);
    await clientBillingNumberingService.mintProformaNumber("09");
    const [sql] = execute.mock.calls[0];
    expect(String(sql)).toMatch(/VALUES \(\?, \?, LAST_INSERT_ID\(1\), NOW\(\)\)/);
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

  it("does not zero-pad at the boundary n=10", async () => {
    execute.mockResolvedValueOnce([{ insertId: 10 }, []]);
    const result = await clientBillingNumberingService.mintBillNumber("09", "Mas Callnet India Pvt Ltd", "2026-27");
    expect(result).toBe("09-10/26-27");
  });

  it("scopes the counter row to kind='bill', scope_key='<stateCode>|<companyName>|<financeYear>'", async () => {
    execute.mockResolvedValueOnce([{ insertId: 1 }, []]);
    await clientBillingNumberingService.mintBillNumber("09", "Mas Callnet India Pvt Ltd", "2026-27");
    const [, params] = execute.mock.calls[0];
    expect(params).toEqual(["bill", "09|Mas Callnet India Pvt Ltd|2026-27"]);
  });
});

describe("mintCreditNoteNumber", () => {
  it("formats as CN-<stateCode>-<NN>/<FYshort>, zero-padded below 10", async () => {
    execute.mockResolvedValueOnce([{ insertId: 3 }, []]);
    const result = await clientBillingNumberingService.mintCreditNoteNumber("09", "Mas Callnet India Pvt Ltd", "2026-27");
    expect(result).toBe("CN-09-03/26-27");
  });

  it("scopes the counter row to kind='credit_note'", async () => {
    execute.mockResolvedValueOnce([{ insertId: 1 }, []]);
    await clientBillingNumberingService.mintCreditNoteNumber("09", "Mas Callnet India Pvt Ltd", "2026-27");
    const [, params] = execute.mock.calls[0];
    expect(params).toEqual(["credit_note", "09|Mas Callnet India Pvt Ltd|2026-27"]);
  });
});

// Gap 3 fix: an optional `conn` lets a caller already inside an open transaction (approveInvoice,
// createProforma) mint on that same connection instead of a separate pool-level `db.execute` call
// — the mixing-pool-with-an-open-transaction hazard documented on each mint function above.
describe("conn parameter (Gap 3 — avoid mixing pool-level execute with an open transaction)", () => {
  it("mintBillNumber uses the pool-level db.execute when no conn is supplied (existing callers unaffected)", async () => {
    execute.mockResolvedValueOnce([{ insertId: 1 }, []]);
    await clientBillingNumberingService.mintBillNumber("09", "Mas Callnet India Pvt Ltd", "2026-27");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("mintBillNumber uses the caller's own conn.execute, not the pool's db.execute, when conn is supplied", async () => {
    const connExecute = vi.fn().mockResolvedValueOnce([{ insertId: 5 }, []]);
    const conn = { execute: connExecute };
    const result = await clientBillingNumberingService.mintBillNumber("09", "Mas Callnet India Pvt Ltd", "2026-27", conn as never);
    expect(result).toBe("09-05/26-27");
    expect(connExecute).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("mintProformaNumber uses the caller's own conn.execute when conn is supplied", async () => {
    const connExecute = vi.fn().mockResolvedValueOnce([{ insertId: 2 }, []]);
    const conn = { execute: connExecute };
    const result = await clientBillingNumberingService.mintProformaNumber("09", conn as never);
    expect(result).toBe("PI/09/2");
    expect(connExecute).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("mintCreditNoteNumber uses the caller's own conn.execute when conn is supplied", async () => {
    const connExecute = vi.fn().mockResolvedValueOnce([{ insertId: 4 }, []]);
    const conn = { execute: connExecute };
    const result = await clientBillingNumberingService.mintCreditNoteNumber("09", "Mas Callnet India Pvt Ltd", "2026-27", conn as never);
    expect(result).toBe("CN-09-04/26-27");
    expect(connExecute).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });
});
