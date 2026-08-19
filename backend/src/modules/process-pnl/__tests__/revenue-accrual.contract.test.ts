import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const moduleDir = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(moduleDir, file), "utf8");

/**
 * Recognised revenue has to be an accrual number, not a raw invoice-line number.
 *
 * The production mirror stores billing_provision_snapshot amounts in rupees. Older code treated
 * them as paise and used them only when a cost centre had no invoice lines at all. That made an
 * open month look worse than trading reality: partial invoicing suppressed the unbilled remainder
 * instead of accruing it. The safe rule is cost-centre grain:
 *
 *   invoice actual + max(provision - invoice actual, 0) - approved credit notes
 */
describe("P&L recognised revenue accrual", () => {
  for (const file of ["ceo-overview.service.ts", "pnl-actuals.service.ts"]) {
    it(`${file} uses provision only as a rupee shortfall top-up`, () => {
      const source = read(file);

      expect(source).toContain(
        "GREATEST(p.provision_amount - COALESCE(i.invoice_amount, 0), 0)",
      );
      expect(source).not.toContain(
        "(CASE WHEN ps.billing_amt > 0 THEN ps.billing_amt ELSE ps.provision_amt END) / 100",
      );
      expect(source).not.toContain("p2.cost_centre_code");
    });
  }

  it("the CEO overview nets approved credit notes before calculating OP", () => {
    const source = read("ceo-overview.service.ts");

    expect(source).toContain("billing_credit_note_snapshot");
    expect(source).toContain("-cn.total_amt AS amount");
    expect(source).toContain("cn.is_approved = 1");
  });
});
