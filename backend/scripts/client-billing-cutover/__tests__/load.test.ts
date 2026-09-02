/**
 * Client Billing Historical Cutover — Task 4: load.ts unit tests.
 * (docs/superpowers/plans/2026-08-19-client-billing-cutover.md Task 4)
 *
 * Exclusively against a mocked db-like object / fixture staging rows — never a
 * real database connection, per this task's own hard stop (see load.ts's
 * header comment).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadValidatedRows,
  parseLegacyDate,
  type LoadDb,
  type StagingInvoiceRow,
  type StagingCreditNoteRow,
} from "../load.js";

function baseInvoiceRow(overrides: Partial<StagingInvoiceRow> = {}): StagingInvoiceRow {
  return {
    id: 1,
    src_id: 5001,
    target_id: "invoice-target-uuid-1",
    target_cost_centre_id: "cc-uuid-1",
    target_gst_type: "Intrastate",
    target_apply_gst: 1,
    src_category: "Others",
    src_finance_year: "24-25",
    src_month: "Jan",
    src_invoicedate: "2025-01-15",
    src_invoicedescription: "Monthly billing",
    src_invoicedeleteremarks: null,
    src_proforma_bill_no: "PI/09/123",
    src_bill_no: "09-123/24-25",
    src_total: "1000",
    src_tax: "180",
    src_igst: "0",
    src_sgst: "90",
    src_cgst: "90",
    src_grnd: "1180",
    validation_status: "valid",
    ...overrides,
  };
}

function baseCreditNoteRow(overrides: Partial<StagingCreditNoteRow> = {}): StagingCreditNoteRow {
  return {
    id: 1,
    src_id: 6001,
    target_id: "credit-note-target-uuid-1",
    target_cost_centre_id: "cc-uuid-1",
    target_invoice_id: "invoice-target-uuid-1",
    target_gst_type: "Intrastate",
    target_apply_gst: 1,
    src_category: "Others",
    src_finance_year: "24-25",
    src_month: "Jan",
    src_creditdate: "2025-01-20",
    src_creditdescription: "Credit for overbilling",
    src_credit_no: "17-06/24-25",
    src_credit_approve: 1,
    src_total: "200",
    src_tax: "36",
    src_igst: "0",
    src_sgst: "18",
    src_cgst: "18",
    src_grnd: "236",
    validation_status: "valid",
    ...overrides,
  };
}

/** A mock connection whose `.execute` calls are scripted in order. Each call
 *  in `scripts` is either a canned [rows, fields] resolution or a function
 *  that throws (to simulate a mid-insert failure). */
function mockConn(scripts: Array<unknown | (() => never)>) {
  let i = 0;
  const execute = vi.fn(async () => {
    const step = scripts[i++];
    if (typeof step === "function") {
      return (step as () => never)();
    }
    return step;
  });
  return {
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
    execute,
  };
}

function mockLoadDb(connections: ReturnType<typeof mockConn>[]): LoadDb {
  let i = 0;
  return {
    getConnection: vi.fn(async () => {
      const conn = connections[i++];
      if (!conn) throw new Error("mockLoadDb: no more connections scripted");
      return conn as any;
    }),
  };
}

describe("parseLegacyDate", () => {
  it("parses ISO date", () => {
    expect(parseLegacyDate("2025-01-15")).toBe("2025-01-15");
  });
  it("parses ISO datetime, keeping only the date part", () => {
    expect(parseLegacyDate("2025-01-15 10:30:00")).toBe("2025-01-15");
  });
  it("parses DD-MM-YYYY", () => {
    expect(parseLegacyDate("15-01-2025")).toBe("2025-01-15");
  });
  it("parses DD/MM/YYYY", () => {
    expect(parseLegacyDate("15/01/2025")).toBe("2025-01-15");
  });
  it("throws on blank", () => {
    expect(() => parseLegacyDate(null)).toThrow(/blank/);
    expect(() => parseLegacyDate("")).toThrow(/blank/);
  });
  it("throws on an unrecognized format", () => {
    expect(() => parseLegacyDate("garbage-date")).toThrow(/does not match/);
  });
});

describe("loadValidatedRows — invoices", () => {
  it("loads a clean valid row: is_migrated=1/legacy_id set, single synthesized line item", async () => {
    const conn = mockConn([
      [[], []], // existence pre-check: no client_invoice row for this legacy_id yet
      [{ affectedRows: 1, insertId: 0 } as any, []], // header INSERT
      [[{ c: 0 }], []], // existing-line count check
      [{} as any, []], // line INSERT
    ]);
    const loadDb = mockLoadDb([conn]);

    const result = await loadValidatedRows(
      loadDb,
      { invoiceRows: [baseInvoiceRow()], creditNoteRows: [] },
      { createdBy: "user-migration-1" },
    );

    expect(result.invoices).toEqual([
      { legacyId: 5001, outcome: "loaded", targetId: "invoice-target-uuid-1" },
    ]);
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);

    // header INSERT ... is_migrated fixed to 1 in the SQL text, legacy_id passed as last param
    const headerCall = conn.execute.mock.calls[1];
    expect(headerCall[0]).toMatch(/is_migrated/);
    expect(headerCall[0]).toMatch(/ON DUPLICATE KEY UPDATE/);
    const headerParams = headerCall[1] as unknown[];
    expect(headerParams[0]).toBe("invoice-target-uuid-1"); // id
    expect(headerParams[headerParams.length - 1]).toBe(5001); // legacy_id

    // line INSERT carries the synthesized single line
    const lineCall = conn.execute.mock.calls[3];
    expect(lineCall[0]).toMatch(/client_invoice_line/);
    const lineParams = lineCall[1] as unknown[];
    expect(lineParams).toContain("invoice-target-uuid-1");
    expect(lineParams).toContain(1000); // rate
    expect(lineParams).toContain(1000); // amount
  });

  it("skips a row with validation_status='error' — no DB calls at all", async () => {
    const loadDb = mockLoadDb([]);
    const result = await loadValidatedRows(
      loadDb,
      { invoiceRows: [baseInvoiceRow({ validation_status: "error" })], creditNoteRows: [] },
      { createdBy: "user-migration-1" },
    );
    expect(result.invoices).toEqual([{ legacyId: 5001, outcome: "skipped_not_valid" }]);
    expect((loadDb.getConnection as any)).not.toHaveBeenCalled();
  });

  it("re-running against an already-loaded legacy_id is idempotent: existence pre-check finds it, no duplicate line inserted", async () => {
    const conn = mockConn([
      [[{ x: 1 }], []], // existence pre-check: a client_invoice row for this legacy_id already exists
      [{ affectedRows: 2, insertId: 0 } as any, []], // header ON DUPLICATE KEY UPDATE branch
      [[{ c: 1 }], []], // line-count check: the line from the original load is already there
      // no line INSERT expected — lineCount > 0
    ]);
    const loadDb = mockLoadDb([conn]);

    const result = await loadValidatedRows(
      loadDb,
      { invoiceRows: [baseInvoiceRow()], creditNoteRows: [] },
      { createdBy: "user-migration-1" },
    );

    expect(result.invoices).toEqual([
      { legacyId: 5001, outcome: "already_loaded", targetId: "invoice-target-uuid-1" },
    ]);
    // Existence pre-check, header UPSERT, line-count check — no 4th call, no line insert.
    expect(conn.execute).toHaveBeenCalledTimes(3);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("rolls back cleanly on a simulated mid-insert failure without affecting a second, independent row's own transaction", async () => {
    const failingConn = mockConn([
      [[], []], // existence pre-check: new row
      [{ affectedRows: 1, insertId: 0 } as any, []], // header INSERT succeeds
      [[{ c: 0 }], []], // existing-line count check
      () => {
        throw new Error("simulated ER_DATA_TOO_LONG on line insert");
      },
    ]);
    const succeedingConn = mockConn([
      [[], []],
      [{ affectedRows: 1, insertId: 0 } as any, []],
      [[{ c: 0 }], []],
      [{} as any, []],
    ]);
    const loadDb = mockLoadDb([failingConn, succeedingConn]);

    const result = await loadValidatedRows(
      loadDb,
      {
        invoiceRows: [baseInvoiceRow({ src_id: 5001 }), baseInvoiceRow({ src_id: 5002, target_id: "invoice-target-uuid-2" })],
        creditNoteRows: [],
      },
      { createdBy: "user-migration-1" },
    );

    expect(result.invoices[0].outcome).toBe("failed");
    expect(result.invoices[0].error).toMatch(/simulated ER_DATA_TOO_LONG/);
    expect(failingConn.rollback).toHaveBeenCalledTimes(1);
    expect(failingConn.commit).not.toHaveBeenCalled();
    expect(failingConn.release).toHaveBeenCalledTimes(1);

    // The second row used its own connection/transaction and committed normally —
    // proof the first row's rollback did not touch it.
    expect(result.invoices[1].outcome).toBe("loaded");
    expect(succeedingConn.commit).toHaveBeenCalledTimes(1);
    expect(succeedingConn.rollback).not.toHaveBeenCalled();
  });

  it("fails loudly (does not silently NULL an INSERT) if a 'valid' row somehow has no target_cost_centre_id", async () => {
    const loadDb = mockLoadDb([]);
    const result = await loadValidatedRows(
      loadDb,
      { invoiceRows: [baseInvoiceRow({ target_cost_centre_id: null })], creditNoteRows: [] },
      { createdBy: "user-migration-1" },
    );
    expect(result.invoices[0].outcome).toBe("failed");
    expect(result.invoices[0].error).toMatch(/target_cost_centre_id missing/);
    expect((loadDb.getConnection as any)).not.toHaveBeenCalled();
  });
});

describe("loadValidatedRows — credit notes", () => {
  it("loads a clean valid credit note row, referencing target_invoice_id", async () => {
    const conn = mockConn([
      [[], []], // existence pre-check: new row
      [{ affectedRows: 1, insertId: 0 } as any, []],
      [[{ c: 0 }], []],
      [{} as any, []],
    ]);
    const loadDb = mockLoadDb([conn]);

    const result = await loadValidatedRows(
      loadDb,
      { invoiceRows: [], creditNoteRows: [baseCreditNoteRow()] },
      { createdBy: "user-migration-1" },
    );

    expect(result.creditNotes).toEqual([
      { legacyId: 6001, outcome: "loaded", targetId: "credit-note-target-uuid-1" },
    ]);
    const headerParams = conn.execute.mock.calls[1][1] as unknown[];
    expect(headerParams[0]).toBe("credit-note-target-uuid-1"); // id
    expect(headerParams[1]).toBe("invoice-target-uuid-1"); // invoice_id (FK)
    expect(headerParams[headerParams.length - 1]).toBe(6001); // legacy_id
  });

  it("skips an 'error' credit note row", async () => {
    const loadDb = mockLoadDb([]);
    const result = await loadValidatedRows(
      loadDb,
      { invoiceRows: [], creditNoteRows: [baseCreditNoteRow({ validation_status: "error" })] },
      { createdBy: "user-migration-1" },
    );
    expect(result.creditNotes).toEqual([{ legacyId: 6001, outcome: "skipped_not_valid" }]);
  });

  it("fails loudly if a 'valid' credit note somehow has no target_invoice_id", async () => {
    const loadDb = mockLoadDb([]);
    const result = await loadValidatedRows(
      loadDb,
      { invoiceRows: [], creditNoteRows: [baseCreditNoteRow({ target_invoice_id: null })] },
      { createdBy: "user-migration-1" },
    );
    expect(result.creditNotes[0].outcome).toBe("failed");
    expect((loadDb.getConnection as any)).not.toHaveBeenCalled();
  });

  it("invoices load before credit notes (FK ordering) even when both are passed together", async () => {
    const invConn = mockConn([
      [[], []],
      [{ affectedRows: 1, insertId: 0 } as any, []],
      [[{ c: 0 }], []],
      [{} as any, []],
    ]);
    const cnConn = mockConn([
      [[], []],
      [{ affectedRows: 1, insertId: 0 } as any, []],
      [[{ c: 0 }], []],
      [{} as any, []],
    ]);
    const order: string[] = [];
    const loadDb: LoadDb = {
      getConnection: vi.fn(async () => {
        if (order.length === 0) {
          order.push("invoice");
          return invConn as any;
        }
        order.push("credit_note");
        return cnConn as any;
      }),
    };

    await loadValidatedRows(
      loadDb,
      { invoiceRows: [baseInvoiceRow()], creditNoteRows: [baseCreditNoteRow()] },
      { createdBy: "user-migration-1" },
    );

    expect(order).toEqual(["invoice", "credit_note"]);
  });
});
