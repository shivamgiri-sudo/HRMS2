import { describe, expect, it } from "vitest";
import { AnalyticsError } from "../analytics.types.js";
import { accessLevel, validateDashboardInput, validateShares, validateWidgets, type Share, type Viewer } from "../dashboards.access.js";

const viewer = (over: Partial<Viewer> = {}): Viewer => ({
  userId: "u-1", roles: ["manager"], isAdmin: false, processIds: new Set(["p-1"]), branchIds: new Set(["b-1"]), ...over,
});
const dash = { ownerUserId: "owner", isTemplate: false };
const share = (principalType: Share["principalType"], principalValue: string, permission: Share["permission"] = "view"): Share =>
  ({ principalType, principalValue, permission });
const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("accessLevel", () => {
  it("owner edits", () => expect(accessLevel({ ownerUserId: "u-1", isTemplate: false }, [], viewer())).toBe("edit"));
  it("admin edits anything", () => expect(accessLevel(dash, [], viewer({ isAdmin: true }))).toBe("edit"));
  it("role share gives view", () => expect(accessLevel(dash, [share("role", "manager")], viewer())).toBe("view"));
  it("user share can give edit", () => expect(accessLevel(dash, [share("user", "u-1", "edit")], viewer())).toBe("edit"));
  it("branch share matches the viewer's branches", () => {
    expect(accessLevel(dash, [share("branch", "b-1")], viewer())).toBe("view");
    expect(accessLevel(dash, [share("branch", "b-2", "edit")], viewer())).toBe("none");
  });
  it("process share matches the viewer's processes", () => {
    expect(accessLevel(dash, [share("process", "p-1", "edit")], viewer())).toBe("edit");
    expect(accessLevel(dash, [share("process", "p-9")], viewer())).toBe("none");
  });
  it("no matching share is none", () => {
    expect(accessLevel(dash, [share("role", "hr", "edit"), share("user", "u-2", "edit")], viewer())).toBe("none");
    expect(accessLevel(dash, [], viewer())).toBe("none");
  });
  it("a template is viewable by everyone, and never more than view", () => {
    expect(accessLevel({ ownerUserId: "owner", isTemplate: true }, [], viewer())).toBe("view");
    expect(accessLevel({ ownerUserId: "owner", isTemplate: true }, [share("role", "hr", "edit")], viewer())).toBe("view");
  });
  it("edit beats view regardless of order", () => {
    expect(accessLevel(dash, [share("role", "manager", "view"), share("user", "u-1", "edit")], viewer())).toBe("edit");
    expect(accessLevel(dash, [share("user", "u-1", "edit"), share("role", "manager", "view")], viewer())).toBe("edit");
  });
});

describe("validateDashboardInput", () => {
  it("needs a name of 1..128 characters", () => {
    expect(() => validateDashboardInput({})).toThrow(AnalyticsError);
    expect(() => validateDashboardInput({ name: "   " })).toThrow(/name/i);
    expect(() => validateDashboardInput({ name: "x".repeat(129) })).toThrow(/128/);
    expect(() => validateDashboardInput(null)).toThrow(AnalyticsError);
  });
  it("applies defaults", () => {
    expect(validateDashboardInput({ name: "  Sales  " })).toEqual({
      name: "Sales", description: null, theme: "light", homeBranchId: null, homeProcessId: null, settings: {},
    });
  });
  it("keeps a known theme and rejects an unknown one", () => {
    expect(validateDashboardInput({ name: "a", theme: "midnight" }).theme).toBe("midnight");
    expect(() => validateDashboardInput({ name: "a", theme: "neon" })).toThrow(/theme/i);
  });
  it("rejects a long description and oversized or non-object settings", () => {
    expect(() => validateDashboardInput({ name: "a", description: "d".repeat(501) })).toThrow(/500/);
    expect(() => validateDashboardInput({ name: "a", settings: { blob: "x".repeat(20001) } })).toThrow(/too large/);
    expect(() => validateDashboardInput({ name: "a", settings: [1, 2] })).toThrow(/object/);
  });
  it("throws INVALID_QUERY", () => {
    try { validateDashboardInput({}); throw new Error("should have thrown"); } catch (e) { expect((e as AnalyticsError).code).toBe("INVALID_QUERY"); }
  });
});

describe("validateWidgets", () => {
  const w = (over: Record<string, unknown> = {}) => ({ widgetType: "bar_chart", ...over });
  it("allows at most 60 widgets", () => {
    expect(validateWidgets(Array.from({ length: 60 }, () => w()))).toHaveLength(60);
    expect(() => validateWidgets(Array.from({ length: 61 }, () => w()))).toThrow(/60/);
    expect(() => validateWidgets("nope")).toThrow(AnalyticsError);
  });
  it("rejects a bad widgetType", () => {
    for (const t of ["Bar", "1bar", "a", "bar chart", "x".repeat(33), undefined]) expect(() => validateWidgets([w({ widgetType: t })])).toThrow(/type/);
  });
  it("keeps a uuid-like id and generates one otherwise", () => {
    const [a, b, c] = validateWidgets([w({ id: UUID }), w({ id: "tmp-1" }), w()]);
    expect(a.id).toBe(UUID);
    expect(b.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.id).not.toBe("tmp-1");
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("never returns the same id twice", () => {
    const [a, b] = validateWidgets([w({ id: UUID }), w({ id: UUID })]);
    expect(a.id).toBe(UUID);
    expect(b.id).not.toBe(UUID);
  });
  it("rejects oversized query, viz or layout", () => {
    const big = "x".repeat(20001);
    expect(() => validateWidgets([w({ viz: { big } })])).toThrow(/too large/);
    expect(() => validateWidgets([w({ layout: { big } })])).toThrow(/too large/);
    expect(() => validateWidgets([w({ query: { dataset: "d", big } })])).toThrow(/too large/);
  });
  it("needs a dataset on a query, but a null query is fine", () => {
    expect(() => validateWidgets([w({ query: { measures: [] } })])).toThrow(/dataset/);
    expect(() => validateWidgets([w({ query: "headcount" })])).toThrow(AnalyticsError);
    expect(validateWidgets([w({ query: null })])[0].query).toBeNull();
    expect(validateWidgets([w()])[0]).toMatchObject({ query: null, viz: {}, layout: {}, title: null, subtitle: null });
    expect(validateWidgets([w({ query: { dataset: "headcount" }, title: "T" })])[0]).toMatchObject({ query: { dataset: "headcount" }, title: "T" });
  });
  it("limits title and subtitle length", () => {
    expect(() => validateWidgets([w({ title: "t".repeat(161) })])).toThrow(/160/);
    expect(() => validateWidgets([w({ subtitle: "t".repeat(256) })])).toThrow(/255/);
  });
});

describe("validateShares", () => {
  it("de-duplicates by type and value, keeping the stronger permission", () => {
    expect(validateShares([
      { principalType: "role", principalValue: "hr", permission: "view" },
      { principalType: "role", principalValue: "hr", permission: "edit" },
      { principalType: "role", principalValue: "hr" },
      { principalType: "user", principalValue: "hr" },
    ])).toEqual([
      { principalType: "role", principalValue: "hr", permission: "edit" },
      { principalType: "user", principalValue: "hr", permission: "view" },
    ]);
  });
  it("rejects a bad type, value or permission", () => {
    expect(() => validateShares([{ principalType: "team", principalValue: "x" }])).toThrow(AnalyticsError);
    expect(() => validateShares([{ principalType: "role", principalValue: "" }])).toThrow(AnalyticsError);
    expect(() => validateShares([{ principalType: "role", principalValue: "x".repeat(65) }])).toThrow(AnalyticsError);
    expect(() => validateShares([{ principalType: "role", principalValue: "hr", permission: "own" }])).toThrow(/permission/);
    expect(() => validateShares({})).toThrow(AnalyticsError);
  });
  it("allows at most 100 shares", () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ principalType: "user", principalValue: `u-${i}` }));
    expect(() => validateShares(many)).toThrow(/100/);
    expect(validateShares(many.slice(0, 100))).toHaveLength(100);
  });
});
