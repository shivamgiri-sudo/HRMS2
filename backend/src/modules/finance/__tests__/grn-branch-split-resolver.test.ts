import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../grn-head-office-bypass.js", () => ({ isHeadOfficeBranch: vi.fn(async (id: string) => id === "ho") }));

import { assertBranchSplitAllowed, classifyBackOffice, isBranchSplitEnabled, pickBackOffice, resolveBranchBackOffice } from "../grn-branch-split.js";

const row = (id: string, code: string, extra: Record<string, unknown> = {}) =>
  classifyBackOffice({ id, cost_centre_code: code, cost_centre_name: code, ...extra });

describe("Back Office cost-centre selection (never guessed)", () => {
  it("NOIDA-2 today: the client cost centre /576 beside the BO pool /577 picks the BO pool", () => {
    const pick = pickBackOffice([
      row("576", "BSS/BO/NOIDA-2/576", { cc_type: "inbound", billing_client_name: "Onfido" }),
      row("577", "BSS/BO/NOIDA-2/577", { cc_type: "backoffice" }),
    ]);
    expect(pick).toMatchObject({ ok: true, costCentre: { id: "577" } });
  });

  it("falls back to a /BO/ code only when no cost centre is declared Back Office by type", () => {
    expect(pickBackOffice([row("1", "BSS/BO/DELHI/301")])).toMatchObject({ ok: true, costCentre: { id: "1" } });
    expect(pickBackOffice([row("1", "BSS/BO/DELHI/301"), row("2", "BSS/BO/DELHI/9", { cc_type: "backoffice" })]))
      .toMatchObject({ ok: true, costCentre: { id: "2" } });
  });

  it("two equally good candidates are refused, never picked", () => {
    expect(pickBackOffice([row("1", "A", { cc_type: "backoffice" }), row("2", "B", { cc_type: "back office" })]))
      .toMatchObject({ ok: false, reason: "AMBIGUOUS" });
    expect(pickBackOffice([row("1", "BSS/BO/X/1"), row("2", "BSS/BO/X/2")])).toMatchObject({ ok: false, reason: "AMBIGUOUS" });
  });

  it("nothing usable, or only client-billed cost centres: refused", () => {
    expect(pickBackOffice([])).toMatchObject({ ok: false, reason: "NONE" });
    expect(pickBackOffice([row("1", "BSS/BO/X/1", { revenue_flag: 1 }), row("2", "BSS/BO/X/2", { billing_client_name: "Acme" })]))
      .toMatchObject({ ok: false, reason: "NONE" });
  });

  it("a cost centre named BO / Back Office is the Back Office when nothing else declares one", () => {
    const named = (id: string, name: string, extra = {}) => classifyBackOffice({ id, cost_centre_code: `C${id}`, cost_centre_name: name, ...extra });
    expect(named("1", "Noida BO").byName).toBe(true);
    expect(named("1", "BO - Noida").byName).toBe(true);
    expect(named("1", "Back-Office Noida").byName).toBe(true);
    expect(named("1", "Bombay Operations").byName).toBe(false);
    expect(named("1", "Boston Process").byName).toBe(false);
    expect(pickBackOffice([named("1", "Noida BO"), named("2", "Onfido Process")])).toMatchObject({ ok: true, costCentre: { id: "1" } });
    // a client-billed cost centre that merely has BO in its name is not the overhead pool
    expect(pickBackOffice([named("1", "Noida BO", { revenue_flag: 1 }), named("2", "Noida BO Pool")])).toMatchObject({ ok: true, costCentre: { id: "2" } });
    expect(pickBackOffice([named("1", "Noida BO"), named("2", "Noida Back Office")])).toMatchObject({ ok: false, reason: "AMBIGUOUS" });
  });

  it("classification reads every place a Back Office can be declared", () => {
    expect(classifyBackOffice({ id: "1", cost_centre_code: "X", cc_type: "BackOffice" }).byType).toBe(true);
    expect(classifyBackOffice({ id: "1", cost_centre_code: "X", cost_center_type: "Back Office" }).byType).toBe(true);
    expect(classifyBackOffice({ id: "1", cost_centre_code: "X", process_type: "BACK_OFFICE" }).byType).toBe(true);
    expect(classifyBackOffice({ id: "1", cost_centre_code: "bss/bo/x/1" }).byCode).toBe(true);
    expect(classifyBackOffice({ id: "1", cost_centre_code: "BSS/BOX/x/1" }).byCode).toBe(false);
  });
});

describe("resolveBranchBackOffice with the database", () => {
  const exec = (rows: Record<string, unknown>[]) => ({ execute: vi.fn(async () => [rows, []]) }) as never;

  it("one candidate resolves; an explicit pick must be a candidate", async () => {
    const e = exec([{ id: "a", cost_centre_code: "BSS/BO/A/1", cc_type: "backoffice" }, { id: "b", cost_centre_code: "BSS/BO/A/2", cc_type: "backoffice" }]);
    await expect(resolveBranchBackOffice("br", null, "A", e)).rejects.toMatchObject({ code: "BO_COST_CENTRE_AMBIGUOUS" });
    await expect(resolveBranchBackOffice("br", "b", "A", e)).resolves.toMatchObject({ id: "b" });
    await expect(resolveBranchBackOffice("br", "zzz", "A", e)).rejects.toMatchObject({ code: "BO_COST_CENTRE_INVALID" });
    await expect(resolveBranchBackOffice("br", null, "A", exec([]))).rejects.toMatchObject({ code: "BO_COST_CENTRE_MISSING" });
  });
});

describe("who may split", () => {
  const base = { grnBranchId: "ho", grnType: "vendor", actorRole: "finance_head", env: { GRN_BRANCH_SPLIT_ENABLED: "true" } as NodeJS.ProcessEnv };
  it("flag defaults to off", () => {
    expect(isBranchSplitEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isBranchSplitEnabled({ GRN_BRANCH_SPLIT_ENABLED: "TRUE" } as NodeJS.ProcessEnv)).toBe(true);
  });
  it("finance head / super admin on a Head Office vendor GRN only", async () => {
    await expect(assertBranchSplitAllowed(base)).resolves.toBeUndefined();
    await expect(assertBranchSplitAllowed({ ...base, actorRole: "employee", actorRoles: ["super_admin"] })).resolves.toBeUndefined();
    await expect(assertBranchSplitAllowed({ ...base, actorRole: "accounts_head" })).rejects.toMatchObject({ code: "BRANCH_SPLIT_ROLE" });
    await expect(assertBranchSplitAllowed({ ...base, grnType: "imprest" })).rejects.toMatchObject({ code: "BRANCH_SPLIT_VENDOR_ONLY" });
    await expect(assertBranchSplitAllowed({ ...base, grnBranchId: "br-A" })).rejects.toMatchObject({ code: "BRANCH_SPLIT_HEAD_OFFICE_ONLY" });
    await expect(assertBranchSplitAllowed({ ...base, env: {} as NodeJS.ProcessEnv })).rejects.toMatchObject({ code: "BRANCH_SPLIT_DISABLED" });
  });
});

describe("branch split options (form picker + pre-launch audit)", () => {
  it("lists every trading branch with its resolved Back Office or why it has none", async () => {
    const { db } = await import("../../../db/mysql.js");
    const exec = db.execute as unknown as ReturnType<typeof vi.fn>;
    const bo = (id: string, code: string, extra: Record<string, unknown> = {}) => ({ id, cost_centre_code: code, cost_centre_name: code, cc_type: "backoffice", ...extra });
    exec.mockReset().mockImplementation(async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("FROM branch_master bm")) return [[{ id: "ho", branch_name: "HEAD OFFICE" }, { id: "br-A", branch_name: "NOIDA-2" }, { id: "br-C", branch_name: "KARNAL" }, { id: "br-D", branch_name: "MOHALI" }], []];
      const branch = String(params?.[0]);
      if (branch === "ho") return [[bo("ho-bo", "BSS/BO/CORP/302")], []];
      if (branch === "br-A") return [[bo("a577", "BSS/BO/NOIDA-2/577"), bo("a576", "BSS/BO/NOIDA-2/576", { cc_type: "inbound", billing_client_name: "Onfido" })], []];
      if (branch === "br-C") return [[bo("c1", "BSS/BO/KARNAL/1"), bo("c2", "BSS/BO/KARNAL/2")], []];
      return [[], []];
    });
    const { getBranchSplitOptions } = await import("../grn-branch-split.js");
    const out = await getBranchSplitOptions({ GRN_BRANCH_SPLIT_ENABLED: "true" } as NodeJS.ProcessEnv);
    expect(out.enabled).toBe(true);
    const by = Object.fromEntries(out.branches.map((b) => [b.branchName, b]));
    expect(by["HEAD OFFICE"]).toMatchObject({ isHeadOffice: true, status: "ok" });
    expect(by["NOIDA-2"]).toMatchObject({ isHeadOffice: false, status: "ok", resolved: { id: "a577" } });
    expect(by["NOIDA-2"].candidates.map((c) => c.id)).toEqual(["a577"]); // the client cost centre is not offered
    expect(by["KARNAL"]).toMatchObject({ status: "ambiguous", resolved: null });
    expect(by["KARNAL"].candidates).toHaveLength(2);
    expect(by["MOHALI"]).toMatchObject({ status: "none", resolved: null, candidates: [] });
  });
});
