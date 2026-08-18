import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * importShiftRotationTypeBatch used to run one UPDATE per row and trust its
 * own affectedRows to tell "found" from "not found" — a real production bug
 * (see the file's own header comment) made that always read 0. The rewrite
 * does a bulk existence check up front instead, then one grouped UPDATE per
 * distinct rotation-type value. This pins that the bulk existence check
 * genuinely drives found/not-found (not affectedRows), and that a duplicate
 * employee_code across rows resolves to the LAST row's value.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { importShiftRotationTypeBatch } from "../shift-rotation-type-bulk.service.js";

function row(id: string, row_no: number, data: Record<string, unknown>) {
  return { id, row_no, normalized_data: JSON.stringify(data) };
}

beforeEach(() => {
  execute.mockReset();
});

describe("importShiftRotationTypeBatch — batched rewrite", () => {
  it("groups rows by rotation type into one UPDATE per value, and flags a not-found code from the bulk existence check", async () => {
    execute.mockResolvedValueOnce([
      [
        row("row-1", 1, { employee_code: "MAS001", shift_rotation_type: "frozen" }),
        row("row-2", 2, { employee_code: "MAS002", shift_rotation_type: "rotating" }),
        row("row-3", 3, { employee_code: "GHOST", shift_rotation_type: "frozen" }),
      ],
      [],
    ]); // 1: SELECT upload_batch_row
    execute.mockResolvedValueOnce([[{ employee_code: "MAS001" }, { employee_code: "MAS002" }], []]); // 2: bulk existence check (GHOST absent)
    execute.mockResolvedValueOnce([{}, []]); // 3: grouped UPDATE (frozen: MAS001)
    execute.mockResolvedValueOnce([{}, []]); // 4: grouped UPDATE (rotating: MAS002)
    execute.mockResolvedValueOnce([{}, []]); // 5: UPDATE upload_batch_row imported
    execute.mockResolvedValueOnce([{}, []]); // 6: UPDATE upload_batch_row error (GHOST)
    execute.mockResolvedValueOnce([{}, []]); // 7: UPDATE upload_batch summary

    const result = await importShiftRotationTypeBatch("batch-1", "user-1");

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toMatch(/GHOST.*not found or inactive/);

    const groupedUpdates = execute.mock.calls.filter(
      ([sql]) => typeof sql === "string" && sql.startsWith("UPDATE employees SET shift_rotation_type")
    );
    expect(groupedUpdates).toHaveLength(2); // one per distinct rotation type value
    expect(groupedUpdates.some((c) => (c[1] as unknown[]).includes("frozen") && (c[1] as unknown[]).includes("MAS001"))).toBe(true);
    expect(groupedUpdates.some((c) => (c[1] as unknown[]).includes("rotating") && (c[1] as unknown[]).includes("MAS002"))).toBe(true);
  });

  it("keeps the LAST row's rotation type when the same employee_code repeats", async () => {
    execute.mockResolvedValueOnce([
      [
        row("row-1", 1, { employee_code: "MAS001", shift_rotation_type: "frozen" }),
        row("row-2", 2, { employee_code: "MAS001", shift_rotation_type: "weekly" }), // later row, different value
      ],
      [],
    ]);
    execute.mockResolvedValueOnce([[{ employee_code: "MAS001" }], []]);
    execute.mockResolvedValueOnce([{}, []]); // grouped UPDATE for 'weekly' only — 'frozen' group should be empty
    execute.mockResolvedValueOnce([{}, []]); // UPDATE upload_batch_row imported
    execute.mockResolvedValueOnce([{}, []]); // UPDATE upload_batch summary

    const result = await importShiftRotationTypeBatch("batch-1", "user-1");

    expect(result.imported).toBe(2); // both rows are still recorded as imported...
    const groupedUpdates = execute.mock.calls.filter(
      ([sql]) => typeof sql === "string" && sql.startsWith("UPDATE employees SET shift_rotation_type")
    );
    // ...but the employees table only takes ONE effective UPDATE, and it's 'weekly' (the last row's value).
    expect(groupedUpdates).toHaveLength(1);
    // No userId here — employees has no updated_by column (only updated_at).
    expect(groupedUpdates[0][1]).toEqual(["weekly", "MAS001"]);
  });

  it("skips invalid rotation type values and missing fields without any DB lookup", async () => {
    execute.mockResolvedValueOnce([
      [
        row("row-1", 1, { employee_code: "MAS001", shift_rotation_type: "nonsense" }),
        row("row-2", 2, { employee_code: "MAS002" }), // missing shift_rotation_type
      ],
      [],
    ]);
    execute.mockResolvedValueOnce([{}, []]); // bulk error UPDATE
    execute.mockResolvedValueOnce([{}, []]); // UPDATE upload_batch summary

    const result = await importShiftRotationTypeBatch("batch-1", "user-1");

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(2);
    // Never reached the employees table at all.
    expect(execute.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("FROM employees"))).toBe(false);
  });
});
