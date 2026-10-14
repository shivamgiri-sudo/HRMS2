import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { applyDraftHeaderEdit, planDraftHeaderEdit } from "../grn-draft-header.js";

/**
 * Editing a saved draft GRN: the vendor, due date / terms, bill date and remarks used to be
 * written only by the create call, which the form skips once the draft exists — so changing them
 * on a re-opened draft "saved" and was silently discarded.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const repoRoot = path.resolve(backendRoot, "..");

const draft = {
  id: "g1",
  grn_type: "vendor",
  status: "draft",
  vendor_id: "v1",
  vendor_name: "Old Vendor",
  bill_date: "2026-10-01",
  accounting_period: "2026-10",
  financial_year: "2026-27",
  payment_terms_days: 30,
  due_date: "2026-10-31",
  remarks: "first",
};

function fakeConnection(vendors: Record<string, { vendor_name: string; is_active: number }>) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  return {
    statements,
    connection: {
      async execute(sql: string, params: unknown[] = []) {
        statements.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
        if (sql.includes("FROM vendor_master")) {
          const vendor = vendors[String(params[0])];
          return [vendor ? [{ id: params[0], ...vendor }] : [], []];
        }
        return [{ affectedRows: 1 }, []];
      },
    } as any,
  };
}

describe("planDraftHeaderEdit", () => {
  it("changes nothing when the header is resent unchanged", () => {
    const plan = planDraftHeaderEdit(draft, {
      vendorId: "v1", billDate: "2026-10-01", dueDate: "2026-10-31", paymentTermsDays: 30, remarks: "first",
    });
    expect(plan).toEqual({ set: {}, vendorIdToVerify: null });
  });

  it("a new due date sets the terms from the bill date", () => {
    expect(planDraftHeaderEdit(draft, { dueDate: "2026-10-16" }).set).toEqual({
      payment_terms_days: 15,
      due_date: "2026-10-16",
    });
  });

  it("terms alone move the due date; omitted fields stay as they are", () => {
    expect(planDraftHeaderEdit(draft, { paymentTermsDays: 45 }).set).toEqual({
      payment_terms_days: 45,
      due_date: "2026-11-15",
    });
  });

  it("a bill date in another month re-derives the accounting month and FY, keeps terms", () => {
    expect(planDraftHeaderEdit(draft, { billDate: "2026-03-20" }).set).toEqual({
      bill_date: "2026-03-20",
      accounting_period: "2026-03",
      financial_year: "2025-26",
      due_date: "2026-04-19",
    });
  });

  it("never re-derives an accounting month that was deliberately overridden", () => {
    const overridden = { ...draft, accounting_period: "2026-09" };
    expect(planDraftHeaderEdit(overridden, { billDate: "2026-10-05" }).set).not.toHaveProperty("accounting_period");
    expect(planDraftHeaderEdit(draft, { billDate: "2026-11-02", accountingPeriod: "2026-10" }).set)
      .not.toHaveProperty("accounting_period");
  });

  it("rejects a due date before the bill date, bad terms and a bad bill date", () => {
    expect(() => planDraftHeaderEdit(draft, { dueDate: "2026-09-30" })).toThrow(/cannot fall before/);
    expect(() => planDraftHeaderEdit(draft, { paymentTermsDays: 400 })).toThrow(/between 0 and 365/);
    expect(() => planDraftHeaderEdit(draft, { paymentTermsDays: 2.5 })).toThrow(/between 0 and 365/);
    expect(() => planDraftHeaderEdit(draft, { billDate: "2026-02-30" })).toThrow(/valid bill/);
  });

  it("remarks: a string replaces (blank clears), undefined leaves them", () => {
    expect(planDraftHeaderEdit(draft, { remarks: "  second " }).set).toEqual({ remarks: "second" });
    expect(planDraftHeaderEdit(draft, { remarks: "" }).set).toEqual({ remarks: null });
    expect(planDraftHeaderEdit(draft, {}).set).toEqual({});
  });

  it("asks for vendor verification only when the vendor actually changes, and never on imprest", () => {
    expect(planDraftHeaderEdit(draft, { vendorId: "v2" }).vendorIdToVerify).toBe("v2");
    expect(planDraftHeaderEdit(draft, { vendorId: "" }).vendorIdToVerify).toBeNull();
    const imprest = { ...draft, grn_type: "imprest", vendor_id: null };
    expect(planDraftHeaderEdit(imprest, { vendorId: "v2", dueDate: "2026-10-05" })).toEqual({
      set: {},
      vendorIdToVerify: null,
    });
  });
});

describe("applyDraftHeaderEdit", () => {
  it("writes the new vendor (with its Vendor Master name) and due date on a draft only", async () => {
    const { connection, statements } = fakeConnection({ v2: { vendor_name: "New Vendor", is_active: 1 } });
    const result = await applyDraftHeaderEdit(connection, draft, { vendorId: "v2", dueDate: "2026-11-15" });
    expect(result.set).toMatchObject({ vendor_id: "v2", vendor_name: "New Vendor", due_date: "2026-11-15", payment_terms_days: 45 });
    expect(result.changes.vendor_id).toEqual({ from: "v1", to: "v2" });
    const update = statements.find((s) => s.sql.startsWith("UPDATE grn_request"))!;
    expect(update.sql).toContain("WHERE id = ? AND status = 'draft'");
    expect(update.params[update.params.length - 1]).toBe("g1");
  });

  it("refuses an inactive or unknown vendor and writes nothing", async () => {
    const { connection, statements } = fakeConnection({ v3: { vendor_name: "Gone", is_active: 0 } });
    await expect(applyDraftHeaderEdit(connection, draft, { vendorId: "v3" })).rejects.toThrow(/inactive/);
    await expect(applyDraftHeaderEdit(connection, draft, { vendorId: "nope" })).rejects.toThrow(/not found/);
    expect(statements.some((s) => s.sql.startsWith("UPDATE"))).toBe(false);
  });

  it("issues no UPDATE when nothing changed", async () => {
    const { connection, statements } = fakeConnection({});
    expect(await applyDraftHeaderEdit(connection, draft, { vendorId: "v1", remarks: "first" })).toEqual({ set: {}, changes: {} });
    expect(statements).toHaveLength(0);
  });
});

describe("wiring", () => {
  it("both draft save paths apply header edits after their draft-status check", () => {
    const service = fs.readFileSync(path.join(backendRoot, "src/modules/finance/grn-smart.service.ts"), "utf8");
    for (const guard of [
      '"Allocations can only be changed while the GRN is a draft"',
      '"Invoice-component GRNs are only supported for vendor GRNs"',
    ]) {
      const at = service.indexOf(guard);
      expect(at).toBeGreaterThan(0);
      expect(service.indexOf("await saveDraftHeader(connection, grn, input, actorUserId, actorRole);", at)).toBeGreaterThan(at);
    }
  });

  it("the form sends the draft header on the invoice-components save", () => {
    const form = fs.readFileSync(path.join(repoRoot, "src/components/finance/grn/BudgetLinkedGrnForm.tsx"), "utf8");
    const call = form.slice(form.indexOf("/invoice-components`, {"));
    for (const field of ["vendorId: form.vendorId", "billDate: form.billDate", "dueDate: form.dueDate", "paymentTermsDays:", "remarks: form.remarks"]) {
      expect(call.slice(0, 4000)).toContain(field);
    }
  });
});
