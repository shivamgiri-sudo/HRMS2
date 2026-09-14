import { beforeEach, describe, expect, it } from "vitest";
import {
  lineHasContent,
  resolveRecoverableDraft,
  LOCAL_DRAFT_MAX_AGE_MS,
} from "@/pages/finance/BranchBudgetManagementWorkspace";
import type { BranchBudgetLineInput } from "@/hooks/useBranchBudget";

// Matches blankLine()'s own defaults in BranchBudgetManagementWorkspace.tsx — kept as a fixture
// here rather than importing it, since it is not (and should not need to be) exported.
function blank(preset: Partial<BranchBudgetLineInput> = {}): BranchBudgetLineInput {
  return {
    attributionScope: "branch_common",
    planningLevel: "branch",
    costCentreId: null,
    processId: null,
    head: "",
    subHead: "",
    itemName: "",
    itemDescription: "",
    quantity: 1,
    unit: "Unit",
    unitRate: 0,
    taxTreatment: "exclusive",
    gstRate: 18,
    gstType: "cgst_sgst",
    recoverableTaxPct: 100,
    preferredVendorId: null,
    allocationDriver: "equal_split",
    justification: "",
    ...preset,
  };
}

const NOW = 1_800_000_000_000; // fixed instant so age math is deterministic

describe("lineHasContent", () => {
  it("is false for an untouched blank line", () => {
    expect(lineHasContent(blank())).toBe(false);
  });

  it("is true once a head is chosen", () => {
    expect(lineHasContent(blank({ head: "Facilities" }))).toBe(true);
  });

  it("is true once an item name is typed", () => {
    expect(lineHasContent(blank({ itemName: "Office rent" }))).toBe(true);
  });

  it("is true once a justification is typed", () => {
    expect(lineHasContent(blank({ justification: "Standard monthly rent" }))).toBe(true);
  });

  it("is true once a non-zero unit rate is entered, even with no text fields", () => {
    expect(lineHasContent(blank({ unitRate: 50000 }))).toBe(true);
  });

  it("is false for whitespace-only text", () => {
    expect(lineHasContent(blank({ itemName: "   ", justification: "  " }))).toBe(false);
  });
});

describe("resolveRecoverableDraft", () => {
  const current = [blank()];

  it("returns null when nothing is stored", () => {
    expect(resolveRecoverableDraft(null, current, NOW)).toBeNull();
  });

  it("returns null for corrupt JSON without throwing", () => {
    expect(() => resolveRecoverableDraft("{not json", current, NOW)).not.toThrow();
    expect(resolveRecoverableDraft("{not json", current, NOW)).toBeNull();
  });

  it("returns null when the stored value has no lines", () => {
    expect(resolveRecoverableDraft(JSON.stringify({ lines: [], savedAt: NOW }), current, NOW)).toBeNull();
  });

  it("returns null when the stored value is missing a timestamp", () => {
    const stored = JSON.stringify({ lines: [blank({ head: "Facilities" })] });
    expect(resolveRecoverableDraft(stored, current, NOW)).toBeNull();
  });

  it("returns null when the draft is older than the max age", () => {
    const stored = JSON.stringify({
      lines: [blank({ head: "Facilities", itemName: "Office rent" })],
      savedAt: NOW - LOCAL_DRAFT_MAX_AGE_MS - 1,
    });
    expect(resolveRecoverableDraft(stored, current, NOW)).toBeNull();
  });

  it("returns the draft when saved just inside the max age", () => {
    const draftLines = [blank({ head: "Facilities", itemName: "Office rent" })];
    const stored = JSON.stringify({ lines: draftLines, savedAt: NOW - LOCAL_DRAFT_MAX_AGE_MS + 1 });
    expect(resolveRecoverableDraft(stored, current, NOW)).toEqual({
      lines: draftLines,
      savedAt: NOW - LOCAL_DRAFT_MAX_AGE_MS + 1,
    });
  });

  it("returns null when the stored draft has no real content (only blank lines)", () => {
    const stored = JSON.stringify({ lines: [blank(), blank()], savedAt: NOW - 1000 });
    expect(resolveRecoverableDraft(stored, current, NOW)).toBeNull();
  });

  it("returns null when the stored draft is identical to what is already loaded", () => {
    const draftLines = [blank({ head: "Facilities", itemName: "Office rent" })];
    const stored = JSON.stringify({ lines: draftLines, savedAt: NOW - 1000 });
    // "currentLines" already equals the draft — e.g. the server just loaded the exact same content.
    expect(resolveRecoverableDraft(stored, draftLines, NOW)).toBeNull();
  });

  it("returns the draft when it differs from what is currently loaded — the real recovery case", () => {
    const draftLines = [
      blank({ head: "Facilities", itemName: "Office rent", justification: "Standard monthly rent" }),
      blank({ head: "IT & Comms", itemName: "Broadband connection", unitRate: 3500 }),
    ];
    const stored = JSON.stringify({ lines: draftLines, savedAt: NOW - 5000 });
    // currentLines is the untouched single blank line a fresh page load starts with.
    const result = resolveRecoverableDraft(stored, [blank()], NOW);
    expect(result).not.toBeNull();
    expect(result?.lines).toHaveLength(2);
    expect(result?.lines[0].itemName).toBe("Office rent");
    expect(result?.lines[1].itemName).toBe("Broadband connection");
    expect(result?.savedAt).toBe(NOW - 5000);
  });
});

describe("end-to-end mirror-then-recover cycle, against the real Storage contract", () => {
  const KEY = "hrms_branch_budget_draft:test-branch:2026-09";

  // This suite runs under vitest's "node" environment (the project's deliberate choice — see
  // vitest.config.ts — since nothing else here touches the DOM), which does not expose a global
  // localStorage. A minimal in-memory Storage stand-in exercises the exact same
  // getItem/setItem/removeItem contract the component calls, without depending on a browser or a
  // particular Node version's experimental Web Storage support.
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it("a draft written the way the mirroring effect writes it is recoverable after a simulated reload", () => {
    const typedLines = [blank({ head: "Facilities", itemName: "Office rent", justification: "Rent" })];
    // Exactly what the mirroring useEffect persists.
    localStorage.setItem(KEY, JSON.stringify({ lines: typedLines, savedAt: NOW }));

    // Simulated reload: a fresh page load starts from a single blank line, then asks whether
    // there's something to recover for this branch/period.
    const recovered = resolveRecoverableDraft(localStorage.getItem(KEY), [blank()], NOW + 1000);
    expect(recovered?.lines).toEqual(typedLines);
  });

  it("a draft cleared after a real save is no longer offered back", () => {
    const typedLines = [blank({ head: "Facilities", itemName: "Office rent" })];
    localStorage.setItem(KEY, JSON.stringify({ lines: typedLines, savedAt: NOW }));

    // What save() does on success.
    localStorage.removeItem(KEY);

    const recovered = resolveRecoverableDraft(localStorage.getItem(KEY), [blank()], NOW + 1000);
    expect(recovered).toBeNull();
  });
});
