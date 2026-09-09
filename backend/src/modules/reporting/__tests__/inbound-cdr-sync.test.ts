import { describe, it, expect } from "vitest";
import { buildPlans } from "../inbound-cdr-sync.service.js";

/**
 * These tests do NOT hit dialer_db (that host was unreachable from this
 * machine's network when this was written -- a LAN/VPN gap, confirmed via
 * ping, unrelated to credentials). They instead assert the generated SQL
 * text is faithful to the SOP's own literal query, since a live end-to-end
 * run could not be completed before this commit. Live verification against
 * real dialer_db output is still required before this is considered fully
 * checked, per this session's standing rule.
 */
describe("buildPlans", () => {
  const plans = buildPlans();

  it("builds a plan for all seven clients from the SOP", () => {
    expect(plans.map((p) => p.code).sort()).toEqual(
      ["BELLAVITA", "CLOVIA", "DU_BANGLADESH", "EXICOM", "GNC", "NEEMANS", "VIEGA"].sort(),
    );
  });

  it("maps each client to the process name confirmed live against process_master", () => {
    const byCode = Object.fromEntries(plans.map((p) => [p.code, p.processName]));
    expect(byCode.GNC).toBe("GNC");
    expect(byCode.BELLAVITA).toBe("Bella-Vita Organic");
    expect(byCode.CLOVIA).toBe("Clovia");
    expect(byCode.NEEMANS).toBe("Neemans Private Limited");
    expect(byCode.VIEGA).toBe("Viega");
    expect(byCode.EXICOM).toBe("Exicom");
    // DU Bangladesh has no process of its own -- it shares "DU Digital"
    // with this session's Korea/Thailand APR (sql/1710).
    expect(byCode.DU_BANGLADESH).toBe("DU Digital");
  });

  it("GNC reads cdr_in_4 with its own six campaigns and the SOP's VDCL/QueueDuration=0 answered rule", () => {
    const gnc = plans.find((p) => p.code === "GNC")!;
    expect(gnc.dailySql).toContain("FROM cdr_in_4");
    expect(gnc.dailySql).toContain("GNC_Order_Related");
    expect(gnc.dailySql).toContain("GNC_Authentication");
    expect(gnc.dailySql).toContain("AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0");
    expect(gnc.mandateSql).toContain("8 AS Mandate");
    expect(gnc.mandateSql).toContain("6 As Required_Login");
  });

  it("Bellavita reads cdr_in_11_5, joins data_master_in for FCR with ClientId 375, per the SOP's documented default", () => {
    const bv = plans.find((p) => p.code === "BELLAVITA")!;
    expect(bv.dailySql).toContain("FROM cdr_in_11_5");
    expect(bv.dailySql).toContain("FROM data_master_in");
    expect(bv.dailySql).toContain("ClientId = 375");
    expect(bv.dailySql).toContain("Field28 = 'FCR'");
    expect(bv.dailySql).toContain("H_Bellavita_Luxury");
    expect(bv.dailySql).toContain("E_Emb_New_Order");
    expect(bv.mandateSql).toContain("14 AS Mandate");
    expect(bv.mandateSql).toContain("12 As Required_Login");
  });

  it("Clovia reads cdr_in_250 with exactly its two campaigns", () => {
    const clovia = plans.find((p) => p.code === "CLOVIA")!;
    expect(clovia.dailySql).toContain("FROM cdr_in_250");
    expect(clovia.dailySql).toContain("Clovia_English");
    expect(clovia.dailySql).toContain("Clovia_Hindi");
    expect(clovia.mandateSql).toContain("7 AS Mandate");
  });

  it("Neemans reads cdr_in_249 filtered to Neemans_IB, SL threshold 30s (not 20s), FCR ClientId 475", () => {
    const neemans = plans.find((p) => p.code === "NEEMANS")!;
    expect(neemans.dailySql).toContain("FROM cdr_in_249");
    expect(neemans.dailySql).toContain("CampaignName = 'Neemans_IB'");
    expect(neemans.dailySql).toContain("TIME_TO_SEC(QueueDuration) <= 30");
    expect(neemans.dailySql).toContain("ClientId = 475");
    expect(neemans.dailySql).toContain("Field2='FCR'");
  });

  it("Viega reads cdr_in_249 filtered to its own campaign, no FCR join", () => {
    const viega = plans.find((p) => p.code === "VIEGA")!;
    expect(viega.dailySql).toContain("FROM cdr_in_249");
    expect(viega.dailySql).toContain("CampaignName = 'Viega'");
    expect(viega.dailySql).not.toContain("data_master_in");
    expect(viega.mandateSql).toContain("2 AS Mandate");
  });

  it("Exicom reads cdr_in_9 with its three campaigns", () => {
    const exicom = plans.find((p) => p.code === "EXICOM")!;
    expect(exicom.dailySql).toContain("FROM cdr_in_9");
    expect(exicom.dailySql).toContain("Exicom_TC_Battery");
    expect(exicom.dailySql).toContain("EV_Charger833");
    expect(exicom.mandateSql).toContain("5 AS Mandate");
  });

  it("DU Bangladesh reads cdr_in_4 (shared with GNC) filtered to its own three campaigns", () => {
    const du = plans.find((p) => p.code === "DU_BANGLADESH")!;
    expect(du.dailySql).toContain("FROM cdr_in_4");
    expect(du.dailySql).toContain("DU_Bangladesh_Bangla");
    expect(du.dailySql).toContain("DU_Bangladesh_Hindi");
    expect(du.mandateSql).toContain("3 AS Mandate");
  });

  it("every daily query is parameterised on CallDate (a single ? bound to the lookback date), never string-interpolated", () => {
    for (const plan of plans) {
      expect(plan.dailySql).toContain("CallDate >= ?");
      expect(plan.mandateSql).toContain("CallDate >= ?");
    }
  });
});
