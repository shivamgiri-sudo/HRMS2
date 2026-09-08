import { describe, it, expect } from "vitest";
import {
  parseFlag, parsePct, parseDate, COMPLIANCE_AUDIT_HEADERS,
} from "../compliance-audit-bulk.service.js";

/**
 * The Form writes "Non- Compliant" — with a space after the hyphen. Matching the
 * exact string would break the day someone tidies that label, and every failure
 * would silently become a pass, which is the worst direction for a security audit
 * to be wrong in.
 */
describe("parseFlag", () => {
  it("reads the Form's own spelling of a failure", () => {
    expect(parseFlag("Non- Compliant")).toBe(0);
    expect(parseFlag("Non-Compliant")).toBe(0);
    expect(parseFlag("non compliant")).toBe(0);
  });

  it("reads a pass", () => {
    expect(parseFlag("Compliant")).toBe(1);
    expect(parseFlag("  compliant ")).toBe(1);
  });

  it("keeps an unanswered parameter NULL rather than scoring it as a failure", () => {
    expect(parseFlag("")).toBeNull();
    expect(parseFlag(null)).toBeNull();
    expect(parseFlag("N/A")).toBeNull();
    expect(parseFlag("something else")).toBeNull();
  });
});

describe("parsePct", () => {
  it("accepts the percentage with or without its sign", () => {
    expect(parsePct("93.75%")).toBe(93.75);
    expect(parsePct("93.75")).toBe(93.75);
    expect(parsePct("100.00%")).toBe(100);
  });

  it("rescales a fraction, which would otherwise read as under one percent", () => {
    expect(parsePct("0.9375")).toBe(93.75);
    expect(parsePct("1")).toBe(100);
  });

  it("returns null for anything unparseable", () => {
    expect(parsePct("")).toBeNull();
    expect(parsePct("n/a")).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads the audit date column's own format", () => {
    expect(parseDate("13-Nov-2025")).toBe("2025-11-13");
    expect(parseDate("01-Jan-2026")).toBe("2026-01-01");
  });

  it("reads the submission timestamp's M/D/YYYY", () => {
    expect(parseDate("11/13/2025 15:37:07")).toBe("2025-11-13");
    expect(parseDate("1/1/2026 11:59:38")).toBe("2026-01-01");
  });

  it("passes an ISO date through and refuses anything else", () => {
    expect(parseDate("2026-09-08")).toBe("2026-09-08");
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("headers", () => {
  it("carries all 29 columns the Form emits, in its order", () => {
    expect(COMPLIANCE_AUDIT_HEADERS).toHaveLength(29);
    expect(COMPLIANCE_AUDIT_HEADERS[0]).toBe("Audit Date");
    expect(COMPLIANCE_AUDIT_HEADERS).toContain("Pen, Paper Access on the floor");
    expect(COMPLIANCE_AUDIT_HEADERS[28]).toBe("Additional Remarks");
  });
});
