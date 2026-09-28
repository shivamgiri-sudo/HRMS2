import { describe, expect, it } from "vitest";
import { ccProcessJoin, ccProcessNameSql, costCentreLabel } from "../cost-centre-label.js";

describe("cost centre + process label", () => {
  it("prints the process beside the code, and the code alone when none is known", () => {
    expect(costCentreLabel("BSS/BO/NOIDA-2/576", "Onfido")).toBe("BSS/BO/NOIDA-2/576 · Onfido");
    expect(costCentreLabel("BSS/OB/NOIDA-2/984", null)).toBe("BSS/OB/NOIDA-2/984");
    expect(costCentreLabel("X", "   ")).toBe("X");
  });

  it("prefers the mapped process, then the billing process name, then the billing client — never employees", () => {
    const sql = ccProcessNameSql("ccm", "pm");
    const order = ["pm.process_name", "ccm.process_name_bill", "ccm.billing_client_name"].map((c) => sql.indexOf(c));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(sql).not.toMatch(/employees/);
    // Blank strings fall through rather than printing an empty process.
    expect(sql.match(/NULLIF\(TRIM/g)).toHaveLength(3);
    expect(ccProcessJoin("c", "p")).toBe("LEFT JOIN process_master p ON p.id = c.process_id");
  });
});
