import { describe, it, expect } from "vitest";
import { scopeAliases, narrowScope } from "../scope.js";
import type { Dataset } from "../analytics.types.js";

const base: Dataset = {
  id: "x", code: "x", name: "x", description: null, category: null, connection: "hrms", sourceTable: "tbl", timeField: null,
  scopeMode: "process_branch", processColumn: "process_id", branchColumn: "branch_id", employeeColumn: null, scopeProcessId: null, maxRows: 10, fields: [],
};

describe("scopeAliases", () => {
  it("process_branch uses the row's own columns", () => {
    expect(scopeAliases(base)).toEqual({ aliases: { processId: "t.`process_id`", branchId: "t.`branch_id`" }, joins: [] });
  });
  it("process joins process_master for the branch", () => {
    const r = scopeAliases({ ...base, scopeMode: "process", branchColumn: null });
    expect(r.joins).toEqual(["LEFT JOIN process_master sp ON sp.id = t.`process_id`"]);
    expect(r.aliases).toEqual({ processId: "t.`process_id`", branchId: "sp.branch_id" });
  });
  it("branch only", () => {
    expect(scopeAliases({ ...base, scopeMode: "branch", processColumn: null })).toEqual({ aliases: { branchId: "t.`branch_id`" }, joins: [] });
  });
  it("employee joins employees", () => {
    const r = scopeAliases({ ...base, scopeMode: "employee", employeeColumn: "employee_id" });
    expect(r.joins).toEqual(["LEFT JOIN employees se ON se.id = t.`employee_id`"]);
    expect(r.aliases).toEqual({ processId: "se.process_id", branchId: "se.branch_id" });
  });
  it("constant and org have no row clause", () => {
    expect(scopeAliases({ ...base, scopeMode: "constant" })).toBeNull();
    expect(scopeAliases({ ...base, scopeMode: "org" })).toBeNull();
  });
  it("rejects a missing column the mode needs", () => {
    expect(() => scopeAliases({ ...base, scopeMode: "employee", employeeColumn: null })).toThrow(/employee column/);
  });
});

describe("narrowScope", () => {
  it("adds IN lists on the same aliases", () => {
    const r = narrowScope({ processId: "t.`p`", branchId: "sp.branch_id" }, { processIds: ["a", "b"], branchIds: ["c"] });
    expect(r).toEqual({ sql: "t.`p` IN (?,?) AND sp.branch_id IN (?)", params: ["a", "b", "c"] });
  });
  it("ignores narrowing the dataset cannot express", () => {
    expect(narrowScope({ branchId: "t.`b`" }, { processIds: ["a"] })).toEqual({ sql: "1=0", params: [] });
    expect(narrowScope({ branchId: "t.`b`" }, {})).toEqual({ sql: "1=1", params: [] });
  });
});
