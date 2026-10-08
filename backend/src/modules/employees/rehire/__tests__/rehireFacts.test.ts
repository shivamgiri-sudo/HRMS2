import { describe, it, expect, vi } from "vitest";
import { loadRehireFacts } from "../rehireFacts.js";

function executor(map: Record<string, unknown[]>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      return [key ? map[key] : [], []];
    }),
  };
}

describe("loadRehireFacts", () => {
  it("assembles facts from the latest non-rejoined exit and computes the gap from its LWD", async () => {
    const ex = executor({
      "LEFT JOIN employee_rehire_control": [{ employment_status: "Resigned", date_of_exit: "2026-09-01", disciplinary_flag: 0, rehire_block_lifted_at: null }],
      "AND LOWER(status) NOT IN": [{ id: "x1", exit_type: "voluntary", exit_sub_type: "resignation", exit_reason_category: "relocation", lwd: "2026-09-10" }],
      "abscond": [{ n: 0 }],
      "FROM employment_stint": [{ n: 0 }],
      "FROM exit_clearance_checklist": [{ n: 0 }],
      "FROM asset_assignment": [{ n: 0 }],
      "FROM full_final_calculation": [{ ff_paid: 0 }],
    });
    const out = await loadRehireFacts(ex as never, "emp-1", "2026-09-20");
    expect(out!.exitRequestId).toBe("x1");
    expect(out!.facts.gapDays).toBe(10);
    expect(out!.facts.exitSubType).toBe("resignation");
    expect(out!.facts.hasExitRecord).toBe(true);
  });

  it("falls back to date_of_exit for the gap when there is no exit record, and marks hasExitRecord=false", async () => {
    const ex = executor({
      "LEFT JOIN employee_rehire_control": [{ employment_status: "Resigned", date_of_exit: "2026-09-01", disciplinary_flag: 0, rehire_block_lifted_at: null }],
      "abscond": [{ n: 0 }],
      "FROM employment_stint": [{ n: 0 }],
      "FROM exit_clearance_checklist": [{ n: 0 }],
      "FROM asset_assignment": [{ n: 0 }],
      "FROM full_final_calculation": [],
    });
    const out = await loadRehireFacts(ex as never, "emp-1", "2026-09-05");
    expect(out!.exitRequestId).toBeNull();
    expect(out!.facts.hasExitRecord).toBe(false);
    expect(out!.facts.gapDays).toBe(4);
    expect(out!.facts.legacyStatusText).toBe("Resigned");
  });

  it("returns null when the employee does not exist", async () => {
    expect(await loadRehireFacts(executor({}) as never, "nope", "2026-09-05")) .toBeNull();
  });
});
