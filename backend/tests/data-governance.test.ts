import { describe, it, expect } from "vitest";
import {
  DATA_GOVERNANCE_REGISTER,
  WRITE_PROHIBITED_DOMAINS,
  PAYROLL_DOMAINS,
  AUDIT_REQUIRED_DOMAINS,
  ACCESS_PATTERN,
  DATA_OWNER,
} from "../src/platform/data-governance.js";

describe("Data Governance Register", () => {
  it("all domains have a non-empty domain_code", () => {
    for (const d of DATA_GOVERNANCE_REGISTER) {
      expect(d.domain_code.length).toBeGreaterThan(0);
    }
  });

  it("no two domains share the same domain_code", () => {
    const codes = DATA_GOVERNANCE_REGISTER.map(d => d.domain_code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it("all domains have a non-empty domain_name", () => {
    for (const d of DATA_GOVERNANCE_REGISTER) {
      expect(d.domain_name.length).toBeGreaterThan(0);
    }
  });

  it("contains at least 10 domains", () => {
    expect(DATA_GOVERNANCE_REGISTER.length).toBeGreaterThanOrEqual(10);
  });

  it("payroll domains must have audit_required=true", () => {
    for (const d of DATA_GOVERNANCE_REGISTER) {
      if (d.payroll_contains) {
        expect(d.audit_required).toBe(true);
      }
    }
  });

  it("PII domains must have audit_required=true", () => {
    for (const d of DATA_GOVERNANCE_REGISTER) {
      if (d.pii_contains) {
        expect(d.audit_required).toBe(true);
      }
    }
  });

  it("LMS_CURRICULUM domain is integration_only (no mas_hrms tables)", () => {
    const lms = DATA_GOVERNANCE_REGISTER.find(d => d.domain_code === "LMS_CURRICULUM");
    expect(lms?.access_pattern).toBe(ACCESS_PATTERN.INTEGRATION_ONLY);
    expect(lms?.tables).toHaveLength(0);
    expect(lms?.data_owner).toBe(DATA_OWNER.LMS_EXTERNAL);
  });

  it("COSEC_BIOMETRIC is read-only sync (no writeback)", () => {
    const cosec = DATA_GOVERNANCE_REGISTER.find(d => d.domain_code === "COSEC_BIOMETRIC");
    expect(cosec?.access_pattern).toBe(ACCESS_PATTERN.SYNC_SNAPSHOT);
    expect(cosec?.data_owner).toBe(DATA_OWNER.COSEC);
  });

  it("CLIENT_PORTAL domain does not contain payroll or PII", () => {
    const portal = DATA_GOVERNANCE_REGISTER.find(d => d.domain_code === "CLIENT_PORTAL");
    expect(portal?.payroll_contains).toBe(false);
    expect(portal?.pii_contains).toBe(false);
  });

  it("PAYROLL_SALARY and TAX_STATUTORY are in PAYROLL_DOMAINS", () => {
    expect(PAYROLL_DOMAINS).toContain("PAYROLL_SALARY");
    expect(PAYROLL_DOMAINS).toContain("TAX_STATUTORY");
  });

  it("CLIENT_PORTAL is not in PAYROLL_DOMAINS", () => {
    expect(PAYROLL_DOMAINS).not.toContain("CLIENT_PORTAL");
  });

  it("LMS and COSEC are in WRITE_PROHIBITED_DOMAINS", () => {
    expect(WRITE_PROHIBITED_DOMAINS).toContain("LMS_CURRICULUM");
    expect(WRITE_PROHIBITED_DOMAINS).toContain("COSEC_BIOMETRIC");
  });

  it("PAYROLL_SALARY is NOT in WRITE_PROHIBITED_DOMAINS (it is read-write)", () => {
    expect(WRITE_PROHIBITED_DOMAINS).not.toContain("PAYROLL_SALARY");
  });

  it("AUDIT_REQUIRED_DOMAINS contains payroll and document vault", () => {
    expect(AUDIT_REQUIRED_DOMAINS).toContain("PAYROLL_SALARY");
    expect(AUDIT_REQUIRED_DOMAINS).toContain("DOCUMENT_VAULT");
    expect(AUDIT_REQUIRED_DOMAINS).toContain("EMPLOYEE_MASTER");
  });
});
