import { describe, it, expect, vi } from "vitest";
import { loadExitSection } from "../dossier.exit.js";
import { buildWindow } from "../dossierTypes.js";

function executor(map: Record<string, unknown[]>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      return [key ? map[key] : [], []];
    }),
  };
}
const w = buildWindow("e1", "2026-09-10", 12);

const exitRow = {
  id: "x1", exit_type: "voluntary", exit_sub_type: "resignation", exit_reason_category: "relocation",
  resignation_reason: "Moving cities", absconding_since: null, lwd: "2026-09-10",
  notice_period_days: 30, notice_start_date: "2026-08-20", status: "exited",
};

describe("loadExitSection", () => {
  it("returns null when the employee has never exited", async () => {
    const ex = executor({ "FROM exit_request": [] });
    expect(await loadExitSection(ex as never, w)).toBeNull();
  });

  it("assembles the exit file: reason, notice served vs required, clearance, assets, F&F", async () => {
    const ex = executor({
      "FROM exit_request": [exitRow],
      "FROM exit_clearance_checklist": [
        { department: "IT", status: "cleared", remarks: null },
        { department: "Admin", status: "pending", remarks: "laptop" },
      ],
      "FROM asset_assignment": [{ asset_name: "Laptop", asset_category: "IT", assigned_date: "2025-01-01" }],
      "FROM full_final_calculation": [{ net_payable: "18250.50", status: "paid", ff_paid_at: "2026-09-25 10:00:00" }],
    });
    const s = (await loadExitSection(ex as never, w))!;
    expect(s).toMatchObject({ exitRequestId: "x1", exitType: "voluntary", subType: "resignation", reasonCategory: "relocation", lastWorkingDay: "2026-09-10", status: "exited" });
    expect(s.notice).toEqual({ requiredDays: 30, servedDays: 21, shortfallDays: 9 });
    expect(s.clearance).toEqual({ total: 2, done: 1, pending: [{ department: "Admin", remarks: "laptop" }] });
    expect(s.assetsHeld).toEqual([{ name: "Laptop", category: "IT", assigned: "2025-01-01" }]);
    expect(s.ff).toEqual({ netPayable: 18250.5, status: "paid", paid: true });
  });

  it("an absconding exit carries the last day present", async () => {
    const ex = executor({
      "FROM exit_request": [{ ...exitRow, exit_sub_type: "absconding", exit_type: "involuntary", absconding_since: "2026-09-01", notice_start_date: null }],
      "FROM exit_clearance_checklist": [],
      "FROM asset_assignment": [],
      "FROM full_final_calculation": [],
    });
    const s = (await loadExitSection(ex as never, w))!;
    expect(s.abscondingSince).toBe("2026-09-01");
    expect(s.notice).toEqual({ requiredDays: 30, servedDays: null, shortfallDays: null });
    expect(s.ff).toBeNull();
  });

  it("never reads draft exits", async () => {
    const ex = executor({ "FROM exit_request": [] });
    await loadExitSection(ex as never, w);
    const sql = String(ex.execute.mock.calls[0]![0]);
    expect(sql).toMatch(/NOT IN \('draft'/i);
  });
});
