import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Every dashboard is stubbed with a marker so the test sees exactly which one(s) V2DashboardView mounts.
const stub = vi.hoisted(() => (name: string) => (props: Record<string, unknown>) =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require("react") as typeof import("react")).createElement("i", { "data-mounted": name, "data-pid": String(props.processId ?? "") }));
vi.mock("@/components/process-dashboard/ProcessDashboard", () => ({ ProcessDashboard: stub("ProcessDashboard") }));
vi.mock("@/pages/NativeInboundDashboard", () => ({ ProjectDetailView: stub("ProjectDetailView") }));
vi.mock("@/components/process-performance/BellavitaSaleDashboard", () => ({ BellavitaSaleDashboard: stub("BellavitaSaleDashboard") }));
vi.mock("@/components/process-performance/GncSaleDashboard", () => ({ GncSaleDashboard: stub("GncSaleDashboard") }));
vi.mock("@/components/process-performance/GncChatDashboard", () => ({ GncChatDashboard: stub("GncChatDashboard") }));
vi.mock("@/components/process-performance/GncTargetsDashboard", () => ({ GncTargetsDashboard: stub("GncTargetsDashboard") }));
vi.mock("@/components/process-performance/ProcessTargetsPage", () => ({ ProcessTargetsPage: stub("ProcessTargetsPage") }));
vi.mock("@/components/process-performance/GncAbandonCartDashboard", () => ({ GncAbandonCartDashboard: stub("GncAbandonCartDashboard") }));
vi.mock("@/components/process-performance/InboundInsightsDashboard", () => ({ InboundInsightsDashboard: stub("InboundInsightsDashboard") }));
vi.mock("@/components/process-performance/NeemansCartDashboard", () => ({ NeemansCartDashboard: stub("NeemansCartDashboard") }));
vi.mock("@/components/process-performance/NeemansPerformanceDashboard", () => ({ NeemansPerformanceDashboard: stub("NeemansPerformanceDashboard") }));
vi.mock("@/components/process-performance/NeemansChatDashboard", () => ({ NeemansChatDashboard: stub("NeemansChatDashboard") }));
vi.mock("@/components/process-performance/BellavitaChatDashboard", () => ({ BellavitaChatDashboard: stub("BellavitaChatDashboard") }));
vi.mock("@/components/process-performance/BellavitaCartDashboard", () => ({ BellavitaCartDashboard: stub("BellavitaCartDashboard") }));
vi.mock("@/components/process-performance/DalmiaDashboard", () => ({ DalmiaDashboard: stub("DalmiaDashboard") }));
vi.mock("@/components/process-performance/SbiCardDashboard", () => ({ SbiCardDashboard: stub("SbiCardDashboard") }));
vi.mock("@/components/process-performance/HousingOwnerDashboard", () => ({ HousingOwnerDashboard: stub("HousingOwnerDashboard") }));
vi.mock("@/components/process-performance/HousingPremiumSaleDashboard", () => ({ HousingPremiumSaleDashboard: stub("HousingPremiumSaleDashboard") }));
vi.mock("@/components/process-performance/LpFeedbackDashboard", () => ({ LpFeedbackDashboard: stub("LpFeedbackDashboard") }));
vi.mock("@/components/process-performance/LpOnboardingDashboard", () => ({ LpOnboardingDashboard: stub("LpOnboardingDashboard") }));
vi.mock("@/components/process-performance/SatyaRetailDashboard", () => ({ SatyaRetailDashboard: stub("SatyaRetailDashboard") }));
vi.mock("@/components/process-performance/CloviaDashboard", () => ({ CloviaDashboard: stub("CloviaDashboard") }));
vi.mock("@/components/process-performance/DuDigitalDashboard", () => ({ DuDigitalDashboard: stub("DuDigitalDashboard") }));
vi.mock("@/components/process-performance/AltRxDashboard", () => ({ AltRxDashboard: stub("AltRxDashboard") }));
vi.mock("@/components/process-performance/BirlanuDashboard", () => ({ BirlanuDashboard: stub("BirlanuDashboard") }));
vi.mock("@/components/process-performance/AppreciateWealthDashboard", () => ({ AppreciateWealthDashboard: stub("AppreciateWealthDashboard") }));
vi.mock("@/components/process-performance/UploaderHub", () => ({ UploaderHub: stub("UploaderHub") }));
vi.mock("@/components/process-performance/UploaderWorkspace", () => ({ UploaderWorkspace: stub("UploaderWorkspace") }));

import { V2DashboardView, DASHBOARDS_BY_COMPANY } from "../v2Dashboards";

const mounted = (html: string) => [...html.matchAll(/data-mounted="([A-Za-z]+)"/g)].map((m) => m[1]);

describe("V2DashboardView renders only the selected dashboard", () => {
  it("Bellavita Overall (key sale_performance) mounts BellavitaSaleDashboard only — never ProcessDashboard with a non-UUID id", () => {
    const html = renderToStaticMarkup(createElement(V2DashboardView, { company: "bellavita", dashboard: { key: "sale_performance", kind: "bellavita_sale" } }));
    expect(mounted(html)).toEqual(["BellavitaSaleDashboard"]);
    expect(html).not.toContain("dashboard.kind");
  });

  it("each registered dashboard mounts exactly one component", () => {
    for (const [company, list] of Object.entries(DASHBOARDS_BY_COMPANY)) {
      for (const d of list ?? []) {
        if (d.kind === "stub") continue;
        const html = renderToStaticMarkup(createElement(V2DashboardView, { company, dashboard: d }));
        expect(mounted(html), `${company}/${d.key}`).toHaveLength(1);
        expect(mounted(html)).not.toContain("ProcessDashboard");
      }
    }
  });

  it("category_template passes its own key (a process UUID) to ProcessDashboard", () => {
    const id = "6f1c2b9e-0000-4000-8000-000000000001";
    const html = renderToStaticMarkup(createElement(V2DashboardView, { company: "x", dashboard: { key: id, kind: "category_template" } }));
    expect(mounted(html)).toEqual(["ProcessDashboard"]);
    expect(html).toContain(`data-pid="${id}"`);
  });
});
