import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../../db/mysql.js";
import { listPackages } from "../payrollMasters.service.js";

/**
 * The package pickers (Payroll Head review, onboarding offer) showed the same package many
 * times, because every create-and-assign / Package Builder save added a new identical catalog
 * row. Pickers now get one entry per distinct package; the admin screen still sees every row.
 */
const mockExecute = db.execute as unknown as ReturnType<typeof vi.fn>;

const pkg = (id: string, created_at: string, over: Record<string, unknown> = {}) => ({
  id, created_at, branch_name: "Noida", cost_centre_code: null, band_code: "B", package_amount: 20000,
  basic: 7377, hra: 2951, conveyance: 1600, special_allowance: 5900, bonus: 614, gross: 18442,
  epf_employee: 885, esic_employee: 138, net_in_hand: 17418, epf_employer: 885, esic_employer: 599,
  admin_charges: 74, ctc: 20000, lta: 0, portfolio: 0, medical: 0, other_allowance: 0, pli: 0,
  professional_tax: 0, ...over,
});

// Newest first, as listPackages orders them.
const ROWS = [
  pkg("p4", "2026-09-30", {}),                         // copy of p1
  pkg("p3", "2026-09-29", { gross: 18500, net_in_hand: 17470 }), // same band + amount, pays differently
  pkg("p2", "2026-09-20", {}),                         // copy of p1
  pkg("p1", "2026-08-01", {}),                         // the original
];

beforeEach(() => {
  mockExecute.mockReset();
  mockExecute.mockResolvedValue([ROWS]);
});

describe("listPackages", () => {
  it("lists each distinct package once, keeping the original row", async () => {
    const rows = await listPackages({ branch: "Noida" });
    expect(rows.map((r) => r.id)).toEqual(["p3", "p1"]);
  });

  it("keeps a package that shares band and amount but pays differently", async () => {
    const rows = await listPackages({ branch: "Noida" });
    expect(rows.find((r) => r.id === "p3")).toBeTruthy();
  });

  it("still lists every row for the admin screen", async () => {
    const rows = await listPackages({ branch: "Noida", includeInactive: true });
    expect(rows.map((r) => r.id)).toEqual(["p4", "p3", "p2", "p1"]);
  });
});
