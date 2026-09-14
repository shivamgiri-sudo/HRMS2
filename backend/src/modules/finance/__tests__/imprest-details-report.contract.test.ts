import { readFileSync } from "fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Imprest Details report is a FORMAT CONTRACT.
 *
 * Taken from the supplied `Imprest_Details` workbook, whose header is exactly:
 *
 *   S.No. | Date | GRN | Exp. Head | Exp. SubHead | INFLOW | OUTFLOW | Balance |
 *   Mode | Chq No | Bank | Remarks
 *
 * Finance reconciles against this shape. A renamed column, a reordered pair, or a helpfully
 * added extra one all break a downstream sheet in a way that looks like nothing is wrong.
 *
 * THE REFERENCE FILE'S OWN NUMBERS ARE THE FIXTURE. Its 25 rows run from an implied opening of
 * 19,817.96 down to 7,675.26, with 12,142.70 of outflow and no inflow at all, and
 * `Balance = previous + INFLOW − OUTFLOW` holds on every single row. Those figures are
 * reproduced below rather than invented, so a change to the running-balance logic fails here
 * against real data.
 *
 * Two details of the total row are easy to get wrong and are asserted explicitly: the word
 * "Total" sits in the **Exp. SubHead** column, not the first one, and **Balance is blank** —
 * the total of a running balance is meaningless.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));

const at = (rel: string) =>
  new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const ROUTES = readFileSync(at("../imprest.routes.ts"), "utf8");

let ledger: typeof import("../imprest-ledger.service.js")["imprestLedgerService"];
beforeAll(async () => {
  ({ imprestLedgerService: ledger } = await import("../imprest-ledger.service.js"));
}, 120_000);

beforeEach(() => execute.mockReset());

/** The opening balance implied by the reference file, and its first four rows. */
const REFERENCE_OPENING = 19_817.96;
const REFERENCE_ROWS = [
  { grn: "Mas/7/26/151", head: "Staff Welfare", sub: "R&R Expenses", out: 40, balance: 19_777.96 },
  { grn: "Mas/7/26/152", head: "Staff Welfare", sub: "R&R Expenses", out: 75, balance: 19_702.96 },
  { grn: "Mas/7/26/153", head: "Repairs & Maintenance", sub: "Office Repair & Maintenance", out: 304, balance: 19_398.96 },
  { grn: "Mas/7/26/154", head: "Repairs & Maintenance", sub: "Office Repair & Maintenance", out: 800, balance: 18_598.96 },
];

function scriptLedger(rows: unknown[], openingCredits: number, openingDebits: number) {
  execute.mockImplementation(async (sql: string) => {
    // The opening query is the aggregate one with a single upper bound; the rows query has no
    // SUM at all. Matched on `< ?` rather than on `transaction_date < ?` because the windowing
    // predicate is now the EFFECTIVE_DATE CASE expression — a row whose transaction_date is the
    // '0000-00-00' the db_bill backfill wrote has to be windowed by its period_code instead, or
    // every one of them lands in every window's opening balance.
    if (/SUM\(CASE WHEN l\.direction='credit'/.test(sql) && /<\s*\?/.test(sql)) {
      return [[{ credits: openingCredits, debits: openingDebits }], []];
    }
    return [rows, []];
  });
}

describe("the report reproduces the reference file's arithmetic", () => {
  it("carries the opening balance in, without showing it as a row", async () => {
    // The reference's first row already has its own outflow applied: 19,817.96 − 40 = 19,777.96.
    scriptLedger(
      REFERENCE_ROWS.map((r) => ({
        id: r.grn, transaction_date: "2026-07-27", direction: "debit", amount: r.out,
        narration: "Cash paid", entry_type: "voucher", grn_number: r.grn,
        expense_head: r.head, expense_sub_head: r.sub,
        payment_mode: null, reference_no: null, bank_name: null,
      })),
      REFERENCE_OPENING, 0,
    );
    const report = await ledger.getDetailsReport({ from: "2026-07-01", to: "2026-07-31" });
    expect(report.opening_balance).toBe(REFERENCE_OPENING);
    expect(report.rows.map((r) => r.balance)).toEqual(REFERENCE_ROWS.map((r) => r.balance));
  });

  it("keeps balance = previous + INFLOW − OUTFLOW on every row", async () => {
    scriptLedger(
      [
        { id: "a", transaction_date: "2026-07-01", direction: "credit", amount: 5000, narration: "top up", entry_type: "allocation", grn_number: null, expense_head: null, expense_sub_head: null, payment_mode: "NEFT", reference_no: "UTR9", bank_name: "HDFC" },
        { id: "b", transaction_date: "2026-07-02", direction: "debit", amount: 1200.5, narration: "lunch", entry_type: "voucher", grn_number: "Mas/7/26/1", expense_head: "Staff Welfare", expense_sub_head: "R&R Expenses", payment_mode: null, reference_no: null, bank_name: null },
        { id: "c", transaction_date: "2026-07-03", direction: "debit", amount: 99.5, narration: "cab", entry_type: "voucher", grn_number: "Mas/7/26/2", expense_head: "Tours, Travelling & Conveyance", expense_sub_head: "Local Conveyance A/c", payment_mode: null, reference_no: null, bank_name: null },
      ],
      1000, 0,
    );
    const report = await ledger.getDetailsReport({ from: "2026-07-01", to: "2026-07-31" });
    let running = report.opening_balance;
    for (const row of report.rows) {
      running = Math.round((running + row.inflow - row.outflow) * 100) / 100;
      expect(row.balance, `balance broke at ${row.grn_number}`).toBe(running);
    }
    expect(report.closing_balance).toBe(running);
  });

  it("puts an amount in exactly one of INFLOW and OUTFLOW", async () => {
    scriptLedger(
      [
        { id: "a", transaction_date: "2026-07-01", direction: "credit", amount: 5000, narration: null, entry_type: "allocation", grn_number: null, expense_head: null, expense_sub_head: null, payment_mode: "NEFT", reference_no: null, bank_name: null },
        { id: "b", transaction_date: "2026-07-02", direction: "debit", amount: 40, narration: null, entry_type: "voucher", grn_number: "g", expense_head: null, expense_sub_head: null, payment_mode: null, reference_no: null, bank_name: null },
      ],
      0, 0,
    );
    const report = await ledger.getDetailsReport({ from: "2026-07-01", to: "2026-07-31" });
    expect(report.rows[0]).toMatchObject({ inflow: 5000, outflow: 0 });
    expect(report.rows[1]).toMatchObject({ inflow: 0, outflow: 40 });
    for (const row of report.rows) {
      expect(row.inflow === 0 || row.outflow === 0, "a row cannot be both an inflow and an outflow").toBe(true);
    }
  });

  it("totals INFLOW and OUTFLOW to the reference's 0 and 12,142.70", async () => {
    const outflows = [40, 75, 304, 800, 851, 540, 86, 1053, 668, 1566, 150, 353, 522, 200, 200,
      320, 180, 158, 1085.7, 1800, 100, 130, 611, 200, 150];
    scriptLedger(
      outflows.map((amount, i) => ({
        id: String(i), transaction_date: "2026-07-27", direction: "debit", amount,
        narration: null, entry_type: "voucher", grn_number: `Mas/7/26/${151 + i}`,
        expense_head: null, expense_sub_head: null,
        payment_mode: null, reference_no: null, bank_name: null,
      })),
      REFERENCE_OPENING, 0,
    );
    const report = await ledger.getDetailsReport({ from: "2026-07-01", to: "2026-07-31" });
    expect(report.totals.inflow).toBe(0);
    expect(report.totals.outflow).toBe(12_142.7);
    expect(report.closing_balance).toBe(7_675.26);
  });

  it("numbers the rows from 1", async () => {
    scriptLedger(
      [1, 2, 3].map((n) => ({
        id: String(n), transaction_date: "2026-07-01", direction: "debit", amount: 10,
        narration: null, entry_type: "voucher", grn_number: null,
        expense_head: null, expense_sub_head: null,
        payment_mode: null, reference_no: null, bank_name: null,
      })),
      500, 0,
    );
    const report = await ledger.getDetailsReport({ from: "2026-07-01", to: "2026-07-31" });
    expect(report.rows.map((r) => r.serial)).toEqual([1, 2, 3]);
  });

  it("leaves Mode, Chq No and Bank empty on a cash voucher", async () => {
    // All 25 rows of the reference are cash outflows and all three columns are blank there.
    // Filling them with a dash would look tidier and would corrupt anything parsing the file.
    scriptLedger(
      [{ id: "a", transaction_date: "2026-07-01", direction: "debit", amount: 40, narration: "cash",
         entry_type: "voucher", grn_number: "Mas/7/26/151", expense_head: "Staff Welfare",
         expense_sub_head: "R&R Expenses", payment_mode: null, reference_no: null, bank_name: null }],
      100, 0,
    );
    const report = await ledger.getDetailsReport({ from: "2026-07-01", to: "2026-07-31" });
    expect(report.rows[0].payment_mode).toBeNull();
    expect(report.rows[0].cheque_no).toBeNull();
    expect(report.rows[0].bank_name).toBeNull();
  });
});

describe("the CSV column contract", () => {
  it("declares the twelve reference columns in order", () => {
    const block = ROUTES.slice(
      ROUTES.indexOf("const IMPREST_DETAIL_COLUMNS"),
      ROUTES.indexOf("] as const;", ROUTES.indexOf("const IMPREST_DETAIL_COLUMNS")),
    );
    const order = ['"S.No."', '"Date"', '"GRN"', '"Exp. Head"', '"Exp. SubHead"', '"INFLOW"',
      '"OUTFLOW"', '"Balance"', '"Mode"', '"Chq No"', '"Bank"', '"Remarks"'];
    const positions = order.map((c) => {
      const at2 = block.indexOf(c);
      expect(at2, `${c} must be a column`).toBeGreaterThan(-1);
      return at2;
    });
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i], `${order[i]} must follow ${order[i - 1]}`).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("writes Total into the Exp. SubHead column, not the first", () => {
    // Column index 4. The reference row is ["","","","","Total",0,12142.7,"","","","",""].
    const totalRow = ROUTES.slice(ROUTES.indexOf("body.push(["), ROUTES.indexOf("]);", ROUTES.indexOf("body.push([")));
    expect(totalRow).toContain('"", "", "", "", "Total"');
  });

  it("leaves Balance blank on the total row", () => {
    const totalRow = ROUTES.slice(ROUTES.indexOf("body.push(["), ROUTES.indexOf("]);", ROUTES.indexOf("body.push([")));
    // inflow and outflow are the last two values before the blanks resume.
    expect(totalRow).toContain("money(report.totals.inflow), money(report.totals.outflow)");
    expect(totalRow).toMatch(/money\(report\.totals\.outflow\),\s*\n?\s*""/);
  });

  it("quotes remarks, which routinely contain commas", () => {
    // "Cash was paid to purchase X, Approved by Y" — an unquoted comma shifts every later
    // column by one, for that row only, which is the hardest kind of corruption to spot.
    expect(ROUTES).toContain('/[",\\r\\n]/.test(text)');
  });

  it("resolves the export through the same scope as the report", () => {
    const exportBlock = ROUTES.slice(ROUTES.indexOf('"/reports/details/export"'));
    expect(exportBlock).toContain("branchScope: await scopeOf(req)");
  });

  it("still requires an explicit date window", () => {
    const exportBlock = ROUTES.slice(ROUTES.indexOf('"/reports/details/export"'));
    expect(exportBlock).toContain("from and to dates are required");
  });
});

describe("the voucher debit reaches the ledger at all", () => {
  /**
   * The gap this closes: allocations posted their credits, but NOTHING ever posted a voucher
   * debit. A float could only go up, the Details report would have shown inflows and no
   * outflows — the exact inverse of the reference workbook, which is 25 outflows and no inflow —
   * and the "float in hand" on the allocation form would have been overstated by everything ever
   * spent. Every piece existed and tested green; only the call site was missing.
   */
  let SRC: string;
  beforeAll(() => {
    SRC = readFileSync(at("../grn-smart.service.ts"), "utf8");
  });

  it("posts a debit when an imprest GRN is approved", () => {
    expect(SRC).toContain("postImprestVoucherDebit(connection, grnId, grn, actorUserId)");
    const helper = SRC.slice(SRC.indexOf("async function postImprestVoucherDebit"));
    expect(helper).toContain('entryType: "voucher"');
    expect(helper).toContain('direction: "debit"');
  });

  it("references the GRN, which is what the report joins on for Head and Sub-head", () => {
    // reference_type must be 'grn_request' or the report's join finds nothing and the GRN,
    // Exp. Head and Exp. SubHead columns are silently blank on every outflow row.
    const helper = SRC.slice(SRC.indexOf("async function postImprestVoucherDebit"));
    expect(helper).toContain('referenceType: "grn_request"');
    expect(helper).toContain("referenceId: grnId");
  });

  it("posts inside the approval transaction, not after it", () => {
    // A debit outside the transaction would move money for a voucher whose approval rolled back.
    const call = SRC.indexOf("postImprestVoucherDebit(connection,");
    const commit = SRC.indexOf("await connection.commit();", call);
    expect(call).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(call);
    // The helper takes the caller's connection rather than opening its own.
    expect(SRC).toContain("connection: PoolConnection,");
  });

  it("only fires for imprest GRNs, leaving the vendor path untouched", () => {
    expect(SRC).toContain('} else if (grn.grn_type === "imprest") {');
    expect(SRC).toContain('if (grn.grn_type === "vendor") {');
  });

  it("audits a skipped debit rather than swallowing it", () => {
    // imprest_manager is empty in production, so throwing would block every imprest approval on
    // deploy. Skipping is right; skipping silently is not.
    const helper = SRC.slice(SRC.indexOf("async function postImprestVoucherDebit"));
    expect(helper).toContain("IMPREST_LEDGER_SKIPPED");
    expect(helper).toContain("No active imprest manager is appointed");
  });

  it("honours the manager's effective dating when resolving one", () => {
    // A manager whose term ended must not be debited for today's spend.
    const helper = SRC.slice(SRC.indexOf("async function postImprestVoucherDebit"));
    expect(helper).toContain("effective_from <= CURDATE()");
    expect(helper).toContain("effective_to >= CURDATE()");
  });
});
