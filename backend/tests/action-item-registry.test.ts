import { describe, it, expect } from "vitest";
import {
  ACTION_ITEM_REGISTRY,
  ACTION_ITEM_MAP,
  ACTION_PRIORITY,
  resolveActionItemDef,
  buildActionDeeplink,
} from "../src/modules/work-inbox/action-item-registry.js";

const KNOWN_TRIGGER_TYPES = [
  "ONBOARDING_STUCK",
  "NAME_MISMATCH",
  "INCENTIVE_APPROVAL",
  "DPDP_WITHDRAWAL_REVIEW",
  "TAT_BREACH",
  "RESIGNATION_MANAGER_DISCUSSION",
  "RESIGNATION_HR_DISCUSSION",
];

describe("Action Item Registry — structural invariants", () => {
  it("contains at least 10 registered item types", () => {
    expect(ACTION_ITEM_REGISTRY.length).toBeGreaterThanOrEqual(10);
  });

  it("no two entries share the same itemType", () => {
    const types = ACTION_ITEM_REGISTRY.map(d => d.itemType);
    expect(new Set(types).size).toBe(types.length);
  });

  it("every entry has a non-empty displayName", () => {
    for (const d of ACTION_ITEM_REGISTRY) {
      expect(d.displayName.trim().length).toBeGreaterThan(0);
    }
  });

  it("every entry has a non-empty module", () => {
    for (const d of ACTION_ITEM_REGISTRY) {
      expect(d.module.trim().length).toBeGreaterThan(0);
    }
  });

  it("every entry has at least one defaultAssigneeRole", () => {
    for (const d of ACTION_ITEM_REGISTRY) {
      expect(d.defaultAssigneeRoles.length).toBeGreaterThan(0);
    }
  });

  it("every entry has a positive defaultTtlHours", () => {
    for (const d of ACTION_ITEM_REGISTRY) {
      expect(d.defaultTtlHours).toBeGreaterThan(0);
    }
  });

  it("every priority value is a known ACTION_PRIORITY", () => {
    const valid = new Set(Object.values(ACTION_PRIORITY));
    for (const d of ACTION_ITEM_REGISTRY) {
      expect(valid.has(d.defaultPriority)).toBe(true);
    }
  });

  it("deeplinkPattern contains {entityId} placeholder for all entries", () => {
    for (const d of ACTION_ITEM_REGISTRY) {
      expect(d.deeplinkPattern).toMatch(/\{entityId\}/);
    }
  });
});

describe("Action Item Registry — lookup helpers", () => {
  it("ACTION_ITEM_MAP has same number of entries as registry", () => {
    expect(ACTION_ITEM_MAP.size).toBe(ACTION_ITEM_REGISTRY.length);
  });

  it("resolveActionItemDef returns null for unknown type", () => {
    expect(resolveActionItemDef("UNKNOWN_TYPE_XYZ")).toBeNull();
  });

  it("resolveActionItemDef returns definition for known type", () => {
    const def = resolveActionItemDef("ONBOARDING_STUCK");
    expect(def).not.toBeNull();
    expect(def!.module).toBe("ATS");
  });

  it("buildActionDeeplink returns undefined for unknown type", () => {
    expect(buildActionDeeplink("NOT_REGISTERED", "entity-123")).toBeUndefined();
  });

  it("buildActionDeeplink substitutes entityId correctly", () => {
    const link = buildActionDeeplink("ONBOARDING_STUCK", "cand-42");
    expect(link).not.toBeUndefined();
    expect(link).toContain("cand-42");
    expect(link).not.toContain("{entityId}");
  });

  it("buildActionDeeplink URL-encodes special characters in entityId", () => {
    const link = buildActionDeeplink("ONBOARDING_STUCK", "abc def&xyz");
    expect(link).not.toContain(" ");
    expect(link).not.toContain("&");
  });
});

describe("Action Item Registry — trigger coverage", () => {
  it("all existing trigger item types are registered", () => {
    for (const type of KNOWN_TRIGGER_TYPES) {
      const def = resolveActionItemDef(type);
      expect(def, `Missing registry entry for trigger type: ${type}`).not.toBeNull();
    }
  });

  it("INCENTIVE_APPROVAL is in PAYROLL module", () => {
    expect(resolveActionItemDef("INCENTIVE_APPROVAL")!.module).toBe("PAYROLL");
  });

  it("TAT_BREACH has CRITICAL priority", () => {
    expect(resolveActionItemDef("TAT_BREACH")!.defaultPriority).toBe(ACTION_PRIORITY.CRITICAL);
  });

  it("DPDP_WITHDRAWAL_REVIEW has CRITICAL priority", () => {
    expect(resolveActionItemDef("DPDP_WITHDRAWAL_REVIEW")!.defaultPriority).toBe(ACTION_PRIORITY.CRITICAL);
  });

  it("PAYROLL_SIGN_OFF_PENDING has CRITICAL priority", () => {
    expect(resolveActionItemDef("PAYROLL_SIGN_OFF_PENDING")!.defaultPriority).toBe(ACTION_PRIORITY.CRITICAL);
  });

  it("scoped items require branchId (requiresScope=true)", () => {
    const scoped = ["ONBOARDING_STUCK", "ROSTER_PUBLISH_PENDING", "LEAVE_APPROVAL_PENDING"];
    for (const type of scoped) {
      expect(resolveActionItemDef(type)!.requiresScope, `Expected requiresScope=true for ${type}`).toBe(true);
    }
  });

  it("global items do not require scope (requiresScope=false)", () => {
    const global = ["NAME_MISMATCH", "INCENTIVE_APPROVAL", "PAYROLL_SIGN_OFF_PENDING", "DPDP_WITHDRAWAL_REVIEW", "TAT_BREACH"];
    for (const type of global) {
      expect(resolveActionItemDef(type)!.requiresScope, `Expected requiresScope=false for ${type}`).toBe(false);
    }
  });
});
