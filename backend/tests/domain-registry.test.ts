import { describe, it, expect } from "vitest";
import { BACKEND_DOMAIN_REGISTRY, DATA_CLASS, PAYROLL_DATA_DOMAINS, FRAGMENTED_DOMAINS } from "../src/platform/domain-registry.js";

describe("Backend domain registry", () => {
  it("all domains have a non-empty domain_code", () => {
    for (const d of BACKEND_DOMAIN_REGISTRY) {
      expect(d.domain_code.length).toBeGreaterThan(0);
    }
  });

  it("no two domains share the same domain_code", () => {
    const codes = BACKEND_DOMAIN_REGISTRY.map(d => d.domain_code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it("all api_prefix values start with /api/", () => {
    for (const d of BACKEND_DOMAIN_REGISTRY) {
      expect(d.api_prefix.startsWith("/api/")).toBe(true);
    }
  });

  it("all domains have a non-empty business_owner", () => {
    for (const d of BACKEND_DOMAIN_REGISTRY) {
      expect(d.business_owner.length).toBeGreaterThan(0);
    }
  });

  it("payroll domain is data_class payroll", () => {
    const payroll = BACKEND_DOMAIN_REGISTRY.find(d => d.domain_code === "PAYROLL");
    expect(payroll?.data_class).toBe(DATA_CLASS.PAYROLL);
  });

  it("client portal domain is NOT payroll data class", () => {
    const portal = BACKEND_DOMAIN_REGISTRY.find(d => d.domain_code === "PORTAL");
    expect(portal?.data_class).not.toBe(DATA_CLASS.PAYROLL);
    expect(portal?.data_class).not.toBe(DATA_CLASS.SENSITIVE);
  });

  it("PAYROLL domain is in PAYROLL_DATA_DOMAINS", () => {
    expect(PAYROLL_DATA_DOMAINS).toContain("PAYROLL");
  });

  it("PORTAL domain is not in PAYROLL_DATA_DOMAINS", () => {
    expect(PAYROLL_DATA_DOMAINS).not.toContain("PORTAL");
  });

  it("fragmented domains all have router_count > 3", () => {
    for (const frag of FRAGMENTED_DOMAINS) {
      expect(frag.router_count).toBeGreaterThan(3);
    }
  });

  it("registry contains at least 15 domains", () => {
    expect(BACKEND_DOMAIN_REGISTRY.length).toBeGreaterThanOrEqual(15);
  });

  it("authentication domain has PUBLIC auth level", () => {
    const auth = BACKEND_DOMAIN_REGISTRY.find(d => d.domain_code === "AUTH");
    expect(auth?.auth_level).toBe("public");
  });
});
