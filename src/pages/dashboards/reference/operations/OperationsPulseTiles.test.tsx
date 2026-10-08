import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { OperationsPulseTiles } from "./OperationsPulseTiles";

const render = (opsPulse: Record<string, unknown>, activeHeadcount: number | null) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <OperationsPulseTiles
        data={{
          opsPulse,
          loading: false,
          metrics: activeHeadcount === null ? {} : { hc: { code: "HEADCOUNT", value: activeHeadcount, detail: { active: activeHeadcount }, available: true } },
        } as unknown as ReferenceDashboardData}
      />
    </MemoryRouter>,
  );

describe("OperationsPulseTiles", () => {
  it("shows the dialler tiles as unavailable, not 0, when the pulse feed has nothing for today", () => {
    const html = render({ agents_logged_in: 0, total_calls: 0, login_adherence_pct: 0, avg_aht_seconds: 0 }, 1066);
    expect(html).toContain("No dialler data for today");
    expect(html).not.toMatch(/>0<span/); // no confident "0" for calls / adherence / AHT
    expect(html).toContain("1,066"); // headcount still comes from the employee master, not the pulse zero
  });

  it("shows real numbers when the dialler is reporting", () => {
    const html = render({ agents_logged_in: 410, total_calls: 5230, login_adherence_pct: 87, avg_aht_seconds: 312 }, 1066);
    expect(html).toContain("5,230");
    expect(html).toContain("312");
    expect(html).not.toContain("No dialler data for today");
  });
});

describe("OperationsPulseTiles - dialler up but silent", () => {
  it("shows calls as unavailable rather than 0 when agents are logged in but no calls are reported", () => {
    const html = render({ agents_logged_in: 150, total_calls: 0, login_adherence_pct: 13.7, avg_aht_seconds: 0 }, 1066);
    expect(html).toContain("Not reported by the dialler feed");
    expect(html).toContain("13.7");
    expect(html).not.toMatch(/Calls handled[\s\S]{0,400}>0</);
  });
});
