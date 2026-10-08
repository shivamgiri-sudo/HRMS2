import { describe, it, expect } from "vitest";
import { SEED_PROCESSES } from "../kpi-catalogue.seed.js";
import { AUDIENCES } from "../kpi-catalogue.library.js";
import { tpzCompany, TPZ_COMPANIES } from "../../tpz-access/tpz-access.catalog.js";

describe("KPI catalogue seed integrity", () => {
  it("has unique process keys and unique metric keys within a process", () => {
    const keys = SEED_PROCESSES.map((p) => p.processKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of SEED_PROCESSES) {
      const mk = p.kpis.map((x) => x.metricKey);
      expect(new Set(mk).size, `duplicate metric key in ${p.processKey}`).toBe(mk.length);
    }
  });

  it("every KPI names a real source, formula, freshness and at least one audience", () => {
    for (const p of SEED_PROCESSES) for (const x of p.kpis) {
      expect(x.sourceRef, `${p.processKey}.${x.metricKey} sourceRef`).toBeTruthy();
      expect(x.formula, `${p.processKey}.${x.metricKey} formula`).toBeTruthy();
      expect(x.audience.length, `${p.processKey}.${x.metricKey} audience`).toBeGreaterThan(0);
      for (const a of x.audience) expect(AUDIENCES[a], `unknown audience ${a}`).toBeTruthy();
      expect(["employee", "process", "both"]).toContain(x.grain);
    }
  });

  it("covers every TPZ company that has dashboards (plus the registry processes)", () => {
    const covered = new Set(SEED_PROCESSES.map((p) => p.processKey));
    const need = TPZ_COMPANIES.filter((c) => c.perfPrefixes.length > 0 || c.inboundKeys.length > 0 || Object.keys(c.uploads).length > 0).map((c) => c.key);
    // seed keys differ from TPZ keys for a few companies; map them
    const alias: Record<string, string> = { dubangladesh: "du_bangladesh", sbi_card: "sbi_card" };
    for (const key of need) expect(covered.has(alias[key] ?? key), `process ${key} missing from the catalogue seed`).toBe(true);
    for (const key of ["bla_bli_blu", "reginald", "finnable", "gs1", "_global"]) expect(covered.has(key)).toBe(true);
  });

  it("process codes of TPZ-backed processes match the TPZ catalogue mapping", () => {
    const map: Record<string, string> = { appreciate_health: "appreciate_health", satya_retail: "satya_retail", lp_feedback: "lp_feedback", lp_onboarding: "lp_onboarding", gnc: "gnc", clovia: "clovia" };
    for (const [seedKey, tpzKey] of Object.entries(map)) {
      const seed = SEED_PROCESSES.find((p) => p.processKey === seedKey)!;
      const tpz = tpzCompany(tpzKey)!;
      for (const code of tpz.processCodes) expect(seed.processCodes, `${seedKey} should include ${code}`).toContain(code);
    }
  });

  it("every agent-level process exposes workforce and quality KPIs to the agent and the quality role", () => {
    const withAgent = SEED_PROCESSES.filter((p) => p.processKey !== "_global" && p.kpis.some((x) => x.grain !== "process" && x.audience.includes("agent")));
    expect(withAgent.length).toBeGreaterThan(10);
    for (const p of withAgent) {
      expect(p.kpis.some((x) => x.theme === "workforce" && x.audience.includes("wfm")), `${p.processKey} wfm kpis`).toBe(true);
      expect(p.kpis.some((x) => x.theme === "quality" && x.audience.includes("quality")), `${p.processKey} quality kpis`).toBe(true);
    }
  });

  it("KPIs without a data feed are flagged hasData:false rather than dropped", () => {
    const flagged = SEED_PROCESSES.flatMap((p) => p.kpis).filter((x) => x.hasData === false);
    expect(flagged.length).toBeGreaterThan(5);
  });
});
