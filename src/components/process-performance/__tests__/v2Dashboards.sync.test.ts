import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMPANIES, DASHBOARDS_BY_COMPANY, v2DashboardsForProcess, V2_COMPANY_LABELS } from "../v2Dashboards";

const SRC = readFileSync(resolve(__dirname, "../v2Dashboards.tsx"), "utf8");

describe("Process Performance V2 <-> Process Operations dashboard sync", () => {
  it("every registered dashboard kind is drawn by V2DashboardView (so both pages can render it)", () => {
    const drawn = new Set([...SRC.matchAll(/dashboard\.kind === "([a-z_]+)"/g)].map((m) => m[1]));
    const missing = Object.values(DASHBOARDS_BY_COMPANY).flat().filter((d) => d && d.kind !== "stub" && !drawn.has(d.kind)).map((d) => d!.kind);
    expect(missing).toEqual([]);
  });

  it("every V2 company with dashboards belongs to a Process Operations process", () => {
    const codes = ["BELLA_VITA", "NEEMANS", "GNC", "APPRICIATE_WEALTH", "CLOVIA", "DALMIA_CEMENT", "DU_DIGITAL", "SBI_CARD", "ERESOLUTION", "HOUSING_OWNER", "HOUSING_PREMIUM", "SATYA_RETAIL", "ALT_RX", "BIRLANU", "VIEGA", "EXICOM", "DU_BANGLADESH"];
    const covered = new Set(codes.flatMap((c) => v2DashboardsForProcess(c, "", V2_COMPANY_LABELS).map((t) => t.company)));
    const orphans = COMPANIES.map((c) => c.key).filter((k) => (DASHBOARDS_BY_COMPANY[k]?.length ?? 0) > 0 && !covered.has(k));
    expect(orphans).toEqual([]);
  });

  it("falls back to an exact name match when the process code is unknown", () => {
    expect(v2DashboardsForProcess("SOMETHING_NEW", "Satya Retail", V2_COMPANY_LABELS).length).toBeGreaterThan(0);
    expect(v2DashboardsForProcess("SOMETHING_NEW", "Unrelated Process", V2_COMPANY_LABELS)).toEqual([]);
  });
});
