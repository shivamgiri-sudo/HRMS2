import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const repoRoot = path.resolve(backendRoot, "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

function readRepo(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("GRN invoice-GST-components (unified vendor-GRN flow)", () => {
  it("migration 1074 is additive-only and registered in the manifest", () => {
    const sql = read("sql/1074_grn_invoice_gst_components.sql");
    const runner = read("src/db/runPendingMigrations.ts");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS grn_invoice_component");
    expect(sql).toContain("ADD COLUMN invoice_component_id CHAR(36) NULL");
    expect(sql).toContain("fk_grn_invoice_component_grn");
    expect(sql).toContain("fk_grn_allocation_component");
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(runner).toContain('"1074_grn_invoice_gst_components.sql"');
  });

  it("saveComponentAllocations validates component count, base amount, and GST slab", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(service).toContain("async saveComponentAllocations(");
    expect(service).toContain('throw new Error("At least one invoice component is required")');
    expect(service).toContain('throw new Error("A GRN cannot exceed 20 invoice components")');
    expect(service).toContain("amount without tax must be greater than zero");
    expect(service).toContain("GST rate must be one of 0%, 5%, 12%, 18%, 28%");
    expect(service).toContain("ALLOWED_GST_RATES = new Set([0, 5, 12, 18, 28])");
  });

  it("blocks imprest GRNs and non-draft GRNs from the invoice-component path", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(service).toContain('throw new Error("Invoice-component GRNs are only supported for vendor GRNs")');
    expect(service).toContain('throw new Error("Invoice components can only be changed while the GRN is a draft")');
  });

  it("enforces one head/sub-head classification per GRN across all cost-centre splits", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(service).toContain("All cost-centre splits must share the same expense head and sub-head");
  });

  /**
   * This used to assert a hard block: a GST-bearing component against an exempt/non_gst budget
   * line threw. `388b5aa9` (2026-08-14) removed that block deliberately — "gross-amount
   * consumption is correct regardless of tax_treatment label" — and the assertion was never
   * updated, so it has been failing against intended behaviour rather than catching a defect.
   *
   * Restoring the block would revert another session's decision, so what is pinned now is the
   * property that makes removing it safe: tax comes from the COMPONENT's own declared base and
   * rate, while the characteristics that decide how tax is treated — IGST vs CGST/SGST, and how
   * much is recoverable — still come from the budget line and are not invented per component.
   *
   * `taxTreatment: "exclusive"` is not the coercion the old title implied. The component supplies
   * amountWithoutTax and its own gstRate, so "exclusive" is simply the correct reading of those
   * two inputs — GST is added on top of a stated base.
   */
  it("takes the GST rate from the component, but gst_type and recoverability from the budget line", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(service).toContain("gstRate: Number(component.gstRate)");
    expect(service).toContain("gstType: String(line.gst_type) as BudgetGstType");
    expect(service).toContain("recoverableTaxPct: Number(line.recoverable_tax_pct)");
    // The rate is still constrained — removing the exempt block did not open the rate up.
    expect(service).toContain("ALLOWED_GST_RATES = new Set([0, 5, 12, 18, 28])");
  });

  /**
   * The ₹1 limit is no longer absolute. `f922f44f` (2026-08-14, "G8") lets Finance Head, Accounts
   * Head and Super Admin accept up to ₹500. That is a deliberate, role-gated policy change, so
   * this asserts the gate rather than the old constant — including that the elevated ceiling is
   * restricted to those three roles, which is the part that actually matters. An unrestricted
   * ₹500 would silently absorb half a thousand rupees of unexplained difference per invoice.
   */
  it("reconciliation: round-off auto-absorbs to the actor's limit and blocks beyond it", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(service).toContain("GRN_INVOICE_COMPONENT_ROUNDOFF_LIMIT = 1.00");
    expect(service).toContain('["finance_head", "accounts_head", "super_admin"].includes(actorRole)');
    expect(service).toContain("const roundoffLimit = isElevatedRole ? 500 : GRN_INVOICE_COMPONENT_ROUNDOFF_LIMIT;");
    expect(service).toContain("Math.abs(diff) > roundoffLimit");
    expect(service).toContain("round-off limit");
    // The round-off is folded into one grid cell's own amount, not layered on top — so
    // Σ grn_cost_allocation.amount_with_tax stays exactly equal to grn_request.amount_with_tax
    // and the pre-existing ALLOCATION_AMOUNT_RECONCILIATION check keeps passing unmodified.
    expect(service).toContain("target.amounts.grossAmount + diff");
    expect(service).toContain("round_off_amount = ?");
  });

  /**
   * Owner ruling 2026-08-16: keep G8's ₹500 ceiling, but stop it being silent.
   *
   * Using the elevated ceiling folded up to ₹500 into a cost-allocation amount, after which the
   * invoice reconciled perfectly — so nothing afterwards distinguished "the numbers agreed" from
   * "someone senior accepted that they didn't". The ceiling is Finance's decision and is
   * unchanged; what is new is that exercising it leaves a record naming the actor, the invoice
   * and the amount.
   */
  it("records an elevated round-off as a sensitive action, and leaves ordinary rounding silent", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(service).toContain('action_type: "GRN_ELEVATED_ROUNDOFF_ACCEPTED"');
    // Gated on the ORDINARY limit, not the elevated one: everything above plain arithmetic
    // rounding is what needs a name against it. Gating on roundoffLimit would record nothing,
    // since anything above that already throws.
    expect(service).toContain("if (Math.abs(diff) > GRN_INVOICE_COMPONENT_ROUNDOFF_LIMIT) {");
    // The amount and both limits are on the record, so a reviewer can see how far past ordinary
    // rounding the call went without re-deriving it.
    expect(service).toContain("difference: diff,");
    expect(service).toContain("ordinary_limit: GRN_INVOICE_COMPONENT_ROUNDOFF_LIMIT,");
    expect(service).toContain("elevated_limit: roundoffLimit,");
    // An audit write must not be able to fail a GRN save that is otherwise valid.
    expect(service).toContain("void logSensitiveAction({");
  });

  it("fans out N cost-centre splits × M components into individual grn_cost_allocation rows", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    const bodyStart = service.indexOf("async saveComponentAllocations(");
    const bodyEnd = service.indexOf("async registerDocuments(");
    const body = service.slice(bodyStart, bodyEnd > -1 ? bodyEnd : undefined);
    // Nested loop shape: components loop inside the cost-centre-splits loop.
    expect(body).toMatch(/for \(const split of resolvedSplits\)[\s\S]*for \(let componentIndex = 0[\s\S]*grid\.push/);
    expect(body).toContain("invoice_component_id");
    expect(body).toContain("componentIds[cell.componentIndex]");
  });

  it("the capacity-exceeded message satisfies the frontend's regex-matched deep-link contract", async () => {
    // As of Group C step 2a/2b (2026-08-22), both saveAllocations() and saveComponentAllocations()
    // reach a money-headroom-exceeded error via allocateAcrossLines() (budget-headroom-gate.service.ts,
    // branch-wide aggregate check) instead of throwing this message directly — the OLD, now-removed,
    // single-line "split allocation exceeds available budget by" literal this test used to grep for
    // no longer exists anywhere in the codebase. Construct the REAL message the current code throws
    // and verify it still satisfies the frontend's regex, rather than asserting a stale literal.
    const { allocateAcrossLines } = await import("../../process-pnl/budget-headroom-gate.service.js");
    let message = "";
    try {
      allocateAcrossLines(null, 1000, []);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("exceeds available budget");

    // The actual contract: BudgetLinkedGrnForm.tsx's onError handler regex-matches this exact
    // phrase to trigger the "Request a budget increase" deep link. Prove the two agree, so a
    // future edit to either side that breaks the pair fails loudly here instead of silently.
    const frontend = readRepo("src/components/finance/grn/BudgetLinkedGrnForm.tsx");
    const regexMatch = frontend.match(/const overBudget = (\/exceeds[^;]+\/i)\.test/);
    expect(regexMatch, "BudgetLinkedGrnForm.tsx's overBudget regex was not found where expected").toBeTruthy();
    // eslint-disable-next-line no-eval -- reconstructing the exact literal already in source, not external input
    const overBudgetRegex = eval(regexMatch![1]) as RegExp;
    expect(overBudgetRegex.test(message)).toBe(true);

    // The quantity-exceeded message is a SEPARATE case — still phrased "split allocation exceeds
    // available quantity by" in grn-smart.service.ts (both saveAllocations() and
    // saveComponentAllocations()) — which the frontend's budget-only regex does not (and should
    // not) match; that is not a "request a budget increase" situation.
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(service).toContain("split allocation exceeds available quantity by");
  });

  it("getWorkspace always returns invoiceComponents (empty for legacy/imprest GRNs, never undefined)", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(service).toContain("const invoiceComponents = await loadInvoiceComponents(connection, grnId);");
    expect(service).toMatch(/return \{\s*grn: grnRows\[0\],\s*allocations,\s*invoiceComponents,/);
  });

  it("buildValidations only runs INVOICE_COMPONENT_RECONCILIATION when components exist, skipping legacy GRNs entirely", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(service).toContain("if (invoiceComponents.length) {");
    expect(service).toContain('code: "INVOICE_COMPONENT_RECONCILIATION"');
  });

  it("INVOICE_COMPONENT_RECONCILIATION tolerates up to the same round-off the save path already allows", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    // The submit-time re-check must not be stricter than saveComponentAllocations, or it blocks
    // GRNs the save path deliberately accepted — which is exactly what a 0.01 tolerance did to a
    // 6-way cost-centre split whose per-cell paise rounding left the grid 0.02 off the components.
    expect(service).toContain("const GRN_INVOICE_COMPONENT_RECONCILIATION_TOLERANCE = 1.00;");
    expect(service).toContain(
      "blocking: Math.abs(componentDiff) > GRN_INVOICE_COMPONENT_RECONCILIATION_TOLERANCE,"
    );
    // The literal 0.01 must be gone from this check specifically.
    const block = service.slice(
      service.indexOf('code: "INVOICE_COMPONENT_RECONCILIATION"'),
      service.indexOf('const exactDuplicates')
    );
    expect(block).not.toContain("0.01");
    // ...but the sibling allocation check keeps its own tighter tolerance, untouched.
    expect(service).toContain("blocking: !allocations.length || Math.abs(totalGross - parentGross) > 0.01,");
  });

  it("the new route is additive — old PUT /:id/allocations route and saveAllocations remain untouched", () => {
    const routes = read("src/modules/finance/grn-smart.routes.ts");
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(routes).toContain('"/:id/invoice-components"');
    expect(routes).toContain('"/:id/allocations"');
    expect(service).toContain("async saveAllocations(");
    expect(service).toContain("async saveComponentAllocations(");
    // Same middleware chain as the existing allocations route.
    const newRouteIdx = routes.indexOf('"/:id/invoice-components"');
    const nextRouteIdx = routes.indexOf('smartGrnRouter.post(\n  "/:id/documents"');
    const routeBlock = routes.slice(newRouteIdx, nextRouteIdx > -1 ? nextRouteIdx : undefined);
    expect(routeBlock).toContain("requireWriteAccess");
    expect(routeBlock).toContain("SMART_WRITE_ROLES");
    expect(routeBlock).toContain("authorizeGrn");
  });

  it("src/lib/gst.ts is the single shared source of the GST slab list used by both flows", () => {
    const gstModule = readRepo("src/lib/gst.ts");
    expect(gstModule).toContain("export const GST_RATES = [0, 5, 12, 18, 28]");
    const backendService = read("src/modules/finance/grn-smart.service.ts");
    // The backend's own allow-list must stay in lockstep with the frontend's dropdown values.
    expect(backendService).toContain("new Set([0, 5, 12, 18, 28])");
  });
});
