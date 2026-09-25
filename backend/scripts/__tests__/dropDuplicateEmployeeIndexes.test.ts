import { describe, expect, it } from "vitest";
import {
  buildDropStatement,
  buildRestoreStatement,
  planDuplicateIndexDrops,
  type IndexRow,
} from "../drop-duplicate-employee-indexes.js";

const idx = (
  name: string,
  columns: string[],
  over: Partial<IndexRow> = {},
): IndexRow[] =>
  columns.map((column, i) => ({
    name,
    nonUnique: 1,
    indexType: "BTREE",
    seq: i + 1,
    column,
    subPart: null,
    collation: "A",
    ...over,
  }));

describe("planDuplicateIndexDrops", () => {
  it("drops all but one index when several have exactly the same columns, keeping the idx_emp_ name", () => {
    const rows = [
      ...idx("idx_employees_department_id", ["department_id"]),
      ...idx("idx_emp_dept", ["department_id"]),
    ];

    const plan = planDuplicateIndexDrops(rows);

    expect(plan).toEqual([
      {
        drop: "idx_employees_department_id",
        keep: "idx_emp_dept",
        columns: ["department_id"],
      },
    ]);
  });

  it("keeps one and drops the other two from a group of three", () => {
    const rows = [
      ...idx("idx_employees_employee_code", ["employee_code"]),
      ...idx("idx_emp_code", ["employee_code"]),
      ...idx("idx_employees_directory_code", ["employee_code"]),
    ];

    const plan = planDuplicateIndexDrops(rows);

    expect(plan.map((p) => p.keep)).toEqual(["idx_emp_code", "idx_emp_code"]);
    expect(plan.map((p) => p.drop).sort()).toEqual([
      "idx_employees_directory_code",
      "idx_employees_employee_code",
    ]);
  });

  it("treats column ORDER as significant: (a,b) and (b,a) are not duplicates", () => {
    const rows = [
      ...idx("idx_a", ["active_status", "process_id"]),
      ...idx("idx_b", ["process_id", "active_status"]),
    ];
    expect(planDuplicateIndexDrops(rows)).toEqual([]);
  });

  it("does not touch a prefix index: (a) is redundant with (a,b) but is not an exact duplicate", () => {
    const rows = [
      ...idx("idx_active", ["active_status"]),
      ...idx("idx_active_process", ["active_status", "process_id"]),
    ];
    expect(planDuplicateIndexDrops(rows)).toEqual([]);
  });

  it("never drops a UNIQUE index, even when a non-unique one has the same columns", () => {
    const rows = [
      ...idx("employee_code", ["employee_code"], { nonUnique: 0 }),
      ...idx("idx_emp_code", ["employee_code"]),
    ];
    expect(planDuplicateIndexDrops(rows)).toEqual([]);
  });

  it("never drops PRIMARY, FULLTEXT or SPATIAL indexes", () => {
    const rows = [
      ...idx("PRIMARY", ["id"], { nonUnique: 0 }),
      ...idx("ft_a", ["full_name"], { indexType: "FULLTEXT" }),
      ...idx("ft_b", ["full_name"], { indexType: "FULLTEXT" }),
    ];
    expect(planDuplicateIndexDrops(rows)).toEqual([]);
  });

  it("does not treat a prefix-length index as a duplicate of a full-column index", () => {
    const rows = [
      ...idx("idx_full", ["official_email"]),
      ...idx("idx_prefix", ["official_email"], { subPart: 20 }),
    ];
    expect(planDuplicateIndexDrops(rows)).toEqual([]);
  });

  it("does not treat a descending index as a duplicate of an ascending one", () => {
    const rows = [
      ...idx("idx_asc", ["created_at"]),
      ...idx("idx_desc", ["created_at"], { collation: "D" }),
    ];
    expect(planDuplicateIndexDrops(rows)).toEqual([]);
  });

  it("is a no-op when there are no duplicates", () => {
    expect(planDuplicateIndexDrops(idx("only_one", ["mobile"]))).toEqual([]);
  });
});

describe("statements", () => {
  it("drops online without locking, one index per statement", () => {
    expect(buildDropStatement("idx_employees_mobile")).toBe(
      "ALTER TABLE `employees` DROP INDEX `idx_employees_mobile`, ALGORITHM=INPLACE, LOCK=NONE",
    );
  });

  it("produces a restore statement that recreates the same index", () => {
    expect(
      buildRestoreStatement("idx_x", ["active_status", "process_id"]),
    ).toBe(
      "ALTER TABLE `employees` ADD INDEX `idx_x` (`active_status`, `process_id`), ALGORITHM=INPLACE, LOCK=NONE",
    );
  });

  it("refuses an unsafe index name rather than building SQL from it", () => {
    expect(() => buildDropStatement("x`; DROP TABLE employees; --")).toThrow();
  });
});
