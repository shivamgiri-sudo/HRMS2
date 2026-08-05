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

  it("blocks a GST-bearing component against an exempt/non-GST budget line, without silently coercing to 0%", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(service).toContain('["exempt", "non_gst"].includes(String(item.line.tax_treatment))');
    expect(service).toContain("cannot carry a GST-bearing invoice component");
  });

  it("reconciliation: ≤₹1 auto-absorbs into round_off_amount, >₹1 blocks submission", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(service).toContain("GRN_INVOICE_COMPONENT_ROUNDOFF_LIMIT = 1.00");
    expect(service).toContain("Math.abs(diff) > GRN_INVOICE_COMPONENT_ROUNDOFF_LIMIT");
    expect(service).toContain("exceeds the ₹1.00 auto-round-off limit");
    // The round-off is folded into one grid cell's own amount, not layered on top — so
    // Σ grn_cost_allocation.amount_with_tax stays exactly equal to grn_request.amount_with_tax
    // and the pre-existing ALLOCATION_AMOUNT_RECONCILIATION check keeps passing unmodified.
    expect(service).toContain("target.amounts.grossAmount + diff");
    expect(service).toContain("round_off_amount = ?");
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

  it("the new capacity-exceeded message satisfies the frontend's regex-matched deep-link contract", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(service).toContain("split allocation exceeds available budget by");

    // The actual contract: BudgetLinkedGrnForm.tsx's onError handler regex-matches this exact
    // phrase to trigger the "Request a budget increase" deep link. Prove the two agree, so a
    // future edit to either side that breaks the pair fails loudly here instead of silently.
    const frontend = readRepo("src/components/finance/grn/BudgetLinkedGrnForm.tsx");
    const regexMatch = frontend.match(/const overBudget = (\/exceeds[^;]+\/i)\.test/);
    expect(regexMatch, "BudgetLinkedGrnForm.tsx's overBudget regex was not found where expected").toBeTruthy();
    // eslint-disable-next-line no-eval -- reconstructing the exact literal already in source, not external input
    const overBudgetRegex = eval(regexMatch![1]) as RegExp;
    const sampleMessage = "Some Item (Some Cost Centre): split allocation exceeds available budget by ₹123.45";
    expect(overBudgetRegex.test(sampleMessage)).toBe(true);
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
