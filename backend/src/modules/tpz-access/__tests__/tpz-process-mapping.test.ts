import { describe, it, expect } from "vitest";
import { TPZ_COMPANIES, tpzCompany } from "../tpz-access.catalog.js";

describe("TPZ company -> process_master mapping", () => {
  it("every company with dashboards, uploads or inbound keys is tied to a process (so it can be branch / process scoped)", () => {
    const unmapped = TPZ_COMPANIES.filter(
      (c) => c.processCodes.length === 0 && (c.perfPrefixes.length > 0 || c.inboundKeys.length > 0 || Object.keys(c.uploads).length > 0),
    ).map((c) => c.key);
    expect(unmapped).toEqual([]);
  });

  it("maps the previously unmapped companies to their process_master codes", () => {
    expect(tpzCompany("appreciate_health")?.processCodes).toContain("APPRICIATE_WEALTH");
    expect(tpzCompany("satya_retail")?.processCodes).toContain("SATYA_RETAIL");
    expect(tpzCompany("lp_feedback")?.processCodes).toContain("ERESOLUTION");
    expect(tpzCompany("lp_onboarding")?.processCodes).toContain("ERESOLUTION");
    expect(tpzCompany("dubangladesh")?.processCodes).toContain("DU_DIGITAL");
  });

  it("maps GNC to GUARDIAN_HC and Satya to IDAM / VST, where their agents actually sit (traced in production)", () => {
    expect(tpzCompany("gnc")?.processCodes).toContain("GUARDIAN_HC");
    expect(tpzCompany("satya_retail")?.processCodes).toEqual(expect.arrayContaining(["IDAM", "VST"]));
  });

  it("maps Housing Owner and Premium to HOUSING_COM, the process row that actually holds the Housing staff", () => {
    expect(tpzCompany("housing_owner")?.processCodes).toContain("HOUSING_COM");
    expect(tpzCompany("housing_premium")?.processCodes).toContain("HOUSING_COM");
  });

  it("also maps the live Noida BSS_* process rows staff are assigned to (verified in production 2026-10-01)", () => {
    expect(tpzCompany("appreciate_health")?.processCodes).toContain("BSS_OB_NOIDA_923");
    expect(tpzCompany("satya_retail")?.processCodes).toContain("BSS_OB_NOIDA_1045");
    expect(tpzCompany("lp_feedback")?.processCodes).toContain("BSS_OB_NOIDA_1005");
    expect(tpzCompany("lp_onboarding")?.processCodes).toContain("BSS_OB_NOIDA_1005");
    expect(tpzCompany("dubangladesh")?.processCodes).toContain("BSS_IB_NOIDA_654");
  });
});
