/**
 * dispatchJoiningKit on a `draft_missing` assembly failure: regenerate the
 * file-less drafts once and assemble once more, then block. Never loops, and a
 * kit that assembles first time never touches the repair.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
const query = vi.fn();
const assembleJoiningKit = vi.fn();
const kitEligibleDocuments = vi.fn();
const regenerateMissingKitDrafts = vi.fn();

vi.mock("../../../db/mysql.js", () => ({ db: { execute, query } }));
vi.mock("../../../config/env.js", () => ({
  env: { JOINING_KIT_ESIGN_ENABLED: true, LUCKPAY_PROVIDER_ENABLED: true, FRONTEND_URL: "https://example.test" },
}));
vi.mock("../joiningKitAssembly.service.js", () => ({ assembleJoiningKit, kitEligibleDocuments }));
vi.mock("../joiningKitDraftRepair.service.js", () => ({ regenerateMissingKitDrafts }));

const { dispatchJoiningKit } = await import("../joiningKitDispatch.service.js");

class AssemblyError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const draftMissing = () => new AssemblyError("draft_missing", "Cannot assemble the kit - 3 document(s) have no generated file");

// A buffer carrying the placeholder marker stops dispatch right after assembly
// with a distinct block, so "assembly succeeded" is observable without touching
// the filesystem or the provider.
const ASSEMBLED_PLACEHOLDER = {
  buffer: Buffer.from("TEMPLATE NOT CONFIGURED"), sha256: "x", items: [], totalPages: 1,
};

const blockedReasons = () =>
  execute.mock.calls
    .filter(([sql]) => /SET status = 'blocked'/.test(sql))
    .map(([, params]) => params[0]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  kitEligibleDocuments.mockResolvedValue([]);
  query.mockResolvedValue([[]]);
  execute.mockImplementation(async (sql: string) => {
    if (/FROM employee_joining_esign_kit k/.test(sql)) {
      return [[{
        id: "kit-1", employee_id: "emp-1", status: "queued", anchor_checklist_id: "a",
        employee_code: "MAS63558", personal_email: "hina@example.test", full_name: "Hina Parmar",
      }]];
    }
    if (/COUNT\(\*\) n/.test(sql)) return [[{ n: 0 }]];
    if (/employee_payroll_head_review/.test(sql)) return [[{ status: "approved" }]];
    return [[]];
  });
});

describe("dispatchJoiningKit draft_missing recovery", () => {
  it("regenerates once and assembles again, without blocking, when the repair produced files", async () => {
    assembleJoiningKit.mockRejectedValueOnce(draftMissing()).mockResolvedValueOnce(ASSEMBLED_PLACEHOLDER);
    regenerateMissingKitDrafts.mockResolvedValue({ attempted: 3, generated: 3, failed: [] });

    const out = await dispatchJoiningKit("kit-1", "hr-1");

    expect(regenerateMissingKitDrafts).toHaveBeenCalledTimes(1);
    expect(regenerateMissingKitDrafts).toHaveBeenCalledWith("emp-1", "hr-1");
    expect(assembleJoiningKit).toHaveBeenCalledTimes(2);
    // Got past assembly (stopped later at the placeholder check), so not draft_missing.
    expect(out.blockedReason).toBe("placeholder_draft");
  });

  it("does not loop: a second draft_missing blocks the kit after exactly one repair", async () => {
    assembleJoiningKit.mockRejectedValue(draftMissing());
    regenerateMissingKitDrafts.mockResolvedValue({ attempted: 3, generated: 0, failed: [{ code: "IT_COMPLIANCE", reason: "x" }] });

    const out = await dispatchJoiningKit("kit-1", "hr-1");

    expect(regenerateMissingKitDrafts).toHaveBeenCalledTimes(1);
    expect(assembleJoiningKit).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ status: "blocked", blockedReason: "draft_missing" });
    expect(blockedReasons()).toEqual(["draft_missing"]);
  });

  it("keeps the original block, without a second assembly, when nothing was repairable", async () => {
    assembleJoiningKit.mockRejectedValue(draftMissing());
    regenerateMissingKitDrafts.mockResolvedValue({ attempted: 0, generated: 0, failed: [] });

    const out = await dispatchJoiningKit("kit-1", null);

    expect(assembleJoiningKit).toHaveBeenCalledTimes(1);
    expect(out.blockedReason).toBe("draft_missing");
  });

  it("blocks with the original error when the repair itself throws", async () => {
    assembleJoiningKit.mockRejectedValue(draftMissing());
    regenerateMissingKitDrafts.mockRejectedValue(new Error("db gone"));

    const out = await dispatchJoiningKit("kit-1", null);

    expect(assembleJoiningKit).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ status: "blocked", blockedReason: "draft_missing" });
  });

  it("never calls the repair for a kit that assembles first time", async () => {
    assembleJoiningKit.mockResolvedValue(ASSEMBLED_PLACEHOLDER);

    await dispatchJoiningKit("kit-1", "hr-1");

    expect(assembleJoiningKit).toHaveBeenCalledTimes(1);
    expect(regenerateMissingKitDrafts).not.toHaveBeenCalled();
  });

  it("never calls the repair for other assembly failures", async () => {
    assembleJoiningKit.mockRejectedValue(new AssemblyError("unreadable_document", "bad pdf"));

    const out = await dispatchJoiningKit("kit-1", "hr-1");

    expect(regenerateMissingKitDrafts).not.toHaveBeenCalled();
    expect(out.blockedReason).toBe("unreadable_document");
  });
});
