import { describe, it, expect } from "vitest";
import { deriveSalaryEstimates } from "../salary-estimates.js";

describe("deriveSalaryEstimates", () => {
  it("reproduces the catalog for band G gross 15,059 (basic 8,000, PF and ESIC): PF 960, ESIC 113, net 13,986", () => {
    const e = deriveSalaryEstimates({ gross: 15059, basic: 8000, pf_applicable: 1, esi_applicable: 1 });
    expect(e.pf_employee).toBe(960);
    expect(e.esic_employee).toBe(113);
    expect(e.net_in_hand).toBe(13986);
    expect(e.employer_pf).toBe(960);
    expect(e.admin_charges).toBe(80);
  });

  it("MAS60227: gross 26,055, basic 14,000, PF yes, ESIC no (over the 21,000 ceiling) -> net 24,375, not the stored 4,675", () => {
    const e = deriveSalaryEstimates({ gross: 26055, basic: 14000, pf_applicable: 1, esi_applicable: 0 });
    expect(e.pf_employee).toBe(1680);
    expect(e.esic_employee).toBe(0);
    expect(e.net_in_hand).toBe(24375);
    expect(e.ctc).toBe(26055 + 1680 + 0 + 140);
    expect(e.ctc).toBe(27875); // matches the CTC the sync already stored
  });

  it("ESIC never applies above 21,000 even when the flag is set", () => {
    const e = deriveSalaryEstimates({ gross: 21001, basic: 10000, pf_applicable: 1, esi_applicable: 1 });
    expect(e.esic_employee).toBe(0);
    expect(e.employer_esi).toBe(0);
  });

  it("a package with no PF and no ESIC (gross = basic = CTC = net)", () => {
    const e = deriveSalaryEstimates({ gross: 13250, basic: 13250, pf_applicable: 0, esi_applicable: 0 });
    expect(e).toMatchObject({ pf_employee: 0, esic_employee: 0, employer_pf: 0, employer_esi: 0, admin_charges: 0, ctc: 13250, net_in_hand: 13250 });
  });

  it("coerces strings and missing values to zero", () => {
    const e = deriveSalaryEstimates({ gross: "15059.00", basic: "8000", pf_applicable: "1", esi_applicable: null });
    expect(e.pf_employee).toBe(960);
    expect(e.esic_employee).toBe(0);
    expect(deriveSalaryEstimates({ gross: undefined, basic: undefined, pf_applicable: undefined, esi_applicable: undefined }).net_in_hand).toBe(0);
  });
});
