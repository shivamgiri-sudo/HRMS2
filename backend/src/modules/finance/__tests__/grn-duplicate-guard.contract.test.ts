import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const at = (rel: string) => new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const VOUCHER = readFileSync(at("../payment-voucher.service.ts"), "utf8");
const DISPATCH = readFileSync(at("../vendor-payment-ledger.service.ts"), "utf8");
const GRN_SERVICE = readFileSync(at("../grn.service.ts"), "utf8");
const GUARD = readFileSync(at("../grn-duplicate-guard.ts"), "utf8");

describe("a bill whose twin is already paid cannot be paid again", () => {
  it("is checked when a payment voucher is raised, per allocated GRN", () => {
    expect(VOUCHER).toContain("assertNoPaidTwin(connection, alloc.vendorPaymentTrackingId");
    expect(VOUCHER).toContain("allow: input.allowPossibleDuplicate === true");
  });
  it("is checked on every dispatch, including the one a voucher release makes", () => {
    expect(DISPATCH).toContain("assertNoPaidTwin(");
    expect(DISPATCH).toContain("allow: payload.allowPossibleDuplicate === true");
  });
  it("only a finance head or super admin can override it", () => {
    expect(GUARD).toContain('new Set(["finance_head", "super_admin"])');
  });
  it("never treats two different real invoice numbers as twins", () => {
    expect(GUARD).toContain("OR ${INVOICE(\"g\")} IS NULL OR ${INVOICE(\"g2\")} IS NULL");
  });
});

describe("a bill already paid under another GRN cannot be submitted again", () => {
  it("is checked when a GRN is submitted for approval", () => {
    expect(GRN_SERVICE).toContain("assertNoPaidTwinForGrn(");
    expect(GRN_SERVICE).toContain("allow: payload?.allowPossibleDuplicate === true");
  });
  it("only blocks on a PAID twin and still lets two different real invoice numbers through", () => {
    expect(GUARD).toContain("AND g2.status = 'paid'");
    expect(GUARD.match(/OR \$\{INVOICE\("g"\)\} IS NULL OR \$\{INVOICE\("g2"\)\} IS NULL/g)?.length).toBe(2);
  });
});
