import { describe, it, expect } from "vitest";
import { parseIdList, idCondition } from "../idList.js";
import { parseLobFilterParam, lobAnd, LOB_NONE_SENTINEL } from "../lobFilter.js";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("parseIdList / idCondition", () => {
  it("splits, trims, de-dupes and drops 'all' placeholders", () => {
    expect(parseIdList(" a, b ,a,,all")).toEqual(["a", "b"]);
    expect(parseIdList(undefined)).toEqual([]);
    expect(parseIdList("__all__")).toEqual([]);
    expect(parseIdList(["x,y"])).toEqual(["x", "y"]);
  });
  it("one id keeps the byte-identical '= ?' form, several use IN", () => {
    expect(idCondition("e.branch_id", ["a"])).toEqual({ sql: "e.branch_id = ?", params: ["a"] });
    expect(idCondition("e.branch_id", ["a", "b"])).toEqual({ sql: "e.branch_id IN (?,?)", params: ["a", "b"] });
  });
});

describe("multi LOB filter", () => {
  it("a single id is unchanged", () => {
    expect(parseLobFilterParam(A)).toEqual({ kind: "lob", id: A });
    expect(lobAnd(parseLobFilterParam(A)).sql).toBe(" AND e.lob_id = ?");
  });
  it("several ids become an IN list", () => {
    const f = parseLobFilterParam(`${A},${B}`);
    expect(f).toEqual({ kind: "multi", ids: [A, B], withUnassigned: false });
    expect(lobAnd(f)).toEqual({ sql: " AND e.lob_id IN (?,?)", params: [A, B] });
  });
  it("ids plus __none__ also keep employees with no LOB", () => {
    const f = parseLobFilterParam(`${A},${LOB_NONE_SENTINEL}`);
    expect(lobAnd(f).sql).toBe(" AND (e.lob_id IN (?) OR e.lob_id IS NULL)");
  });
  it("rejects a malformed id in the list", () => {
    expect(() => parseLobFilterParam(`${A},nope`)).toThrow();
  });
});
