import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get, put, post: vi.fn() } }));

import { fetchInboundConfig, fetchInboundTab, probeProcess, saveInboundConfig } from "../api";
import { InboundSourcePanel, emptyInboundForm, formFromStored, toInboundPayload, validateInboundForm } from "../InboundSourcePanel";
import { NotFoundOrForbidden } from "../ProcessDashboard";
import { setBreadcrumbLabel, useBreadcrumbLabels } from "@/lib/breadcrumbLabel";

const read = (p: string) => readFileSync(resolve(__dirname, "..", "..", "..", "..", p), "utf8");

describe("inbound source form", () => {
  it("explains every missing requirement", () => {
    const m = validateInboundForm(emptyInboundForm()).join(" ");
    expect(m).toMatch(/dialer table/); expect(m).toMatch(/at least one campaign/);
  });
  it("validates numbers and FCR", () => {
    const f = { ...emptyInboundForm(), dialerTable: "cdr_in_4", campaigns: ["A"], mandate: "x", required: "-1", slSeconds: "99999", hasFcr: true, fcrClientId: "" };
    const m = validateInboundForm(f).join(" ");
    expect(m).toMatch(/Mandate/); expect(m).toMatch(/Required/); expect(m).toMatch(/Service level/); expect(m).toMatch(/FCR/);
  });
  it("a complete form passes and builds the API payload (blank SL = null, no FCR id unless FCR on)", () => {
    const f = { ...emptyInboundForm(), dialerTable: "cdr_in_77", pattern: "A" as const, campaigns: ["C1", "C2"], mandate: "8", required: "6" };
    expect(validateInboundForm(f)).toEqual([]);
    expect(toInboundPayload(f)).toEqual({ dialerTable: "cdr_in_77", pattern: "A", campaigns: ["C1", "C2"], mandate: 8, required: 6, hasFcr: false, fcrClientId: null, slSeconds: null, enabled: true });
    expect(toInboundPayload({ ...f, hasFcr: true, fcrClientId: "475", slSeconds: "25" })).toMatchObject({ hasFcr: true, fcrClientId: 475, slSeconds: 25 });
  });
  it("round-trips a stored row", () => {
    const f = formFromStored({ processId: "p", projectKey: "acme", dialerTable: "cdr_in_77", pattern: "B", campaigns: ["A"], mandate: 5, required: 4, hasFcr: false, fcrClientId: null, slSeconds: 25, enabled: false });
    expect(f).toMatchObject({ dialerTable: "cdr_in_77", mandate: "5", slSeconds: "25", enabled: false });
    expect(formFromStored(null)).toEqual(emptyInboundForm());
  });
});

describe("InboundSourcePanel render", () => {
  const wrap = (el: JSX.Element) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>);
  it("asks for a process first", () => expect(wrap(<InboundSourcePanel processId="" />)).toContain("Choose a process first."));
  it("shows a skeleton panel while the stored config loads", () => {
    const html = wrap(<InboundSourcePanel processId="11111111-1111-1111-1111-111111111111" />);
    expect(html).toContain("Inbound dialer source"); expect(html).toContain("animate-pulse");
  });
});

describe("api helpers", () => {
  beforeEach(() => { get.mockReset(); put.mockReset(); });
  it("probeProcess maps 403/404/other to forbidden/missing/error", async () => {
    get.mockRejectedValueOnce(Object.assign(new Error("x"), { status: 403 })); expect(await probeProcess("p")).toBe("forbidden");
    get.mockRejectedValueOnce(Object.assign(new Error("x"), { status: 404 })); expect(await probeProcess("p")).toBe("missing");
    get.mockRejectedValueOnce(Object.assign(new Error("x"), { status: 500 })); expect(await probeProcess("p")).toBe("error");
    get.mockResolvedValueOnce({ success: true, data: {} }); expect(await probeProcess("p")).toBe("exists");
  });
  it("fetchInboundTab never throws and returns null when absent or forbidden", async () => {
    get.mockResolvedValueOnce({ success: true, data: null }); expect(await fetchInboundTab("p")).toBeNull();
    get.mockRejectedValueOnce(Object.assign(new Error("x"), { status: 403 })); expect(await fetchInboundTab("p")).toBeNull();
    get.mockResolvedValueOnce({ success: true, data: { projectKey: "acme", name: "Acme" } }); expect(await fetchInboundTab("p")).toEqual({ projectKey: "acme", name: "Acme" });
  });
  it("fetchInboundConfig treats null data as no config; save PUTs to the process path", async () => {
    get.mockResolvedValueOnce({ success: true, data: null }); expect(await fetchInboundConfig("p1")).toBeNull();
    put.mockResolvedValueOnce({ success: true, data: { projectKey: "acme" } });
    await saveInboundConfig("a b", { dialerTable: "cdr_in_1", pattern: "B", campaigns: ["x"], mandate: 0, required: 0, hasFcr: false, fcrClientId: null, slSeconds: null, enabled: true });
    expect(put.mock.calls[0][0]).toBe("/api/process-dashboard/admin/inbound/a%20b");
  });
});

describe("generic page wiring", () => {
  it("unknown / forbidden id shows the access message, distinct from Not configured", () => {
    const html = renderToStaticMarkup(<NotFoundOrForbidden />);
    expect(html).toContain("This process was not found or you do not have access."); expect(html).not.toContain("Not configured yet");
    const src = read("src/components/process-dashboard/ProcessDashboard.tsx");
    expect(src).toContain('probe.data === "forbidden"'); expect(src).toContain('probe.data === "missing"'); expect(src).toContain("Not configured yet");
  });
  it("renders the Live inbound tab by reusing InboundInsightsDashboard (not a fork)", () => {
    const src = read("src/components/process-dashboard/ProcessDashboard.tsx");
    expect(src).toContain("Live inbound"); expect(src).toContain('import("@/components/process-performance/InboundInsightsDashboard")'); expect(src).toContain("projectKey={tab.projectKey}");
  });
  it("V2 category_template tiles render ProcessDashboard, which owns the tab", () => {
    expect(read("src/components/process-performance/v2Dashboards.tsx")).toMatch(/kind === "category_template" \? \(\s*<ProcessDashboard/);
  });
  it("setup shows the inbound panel only for support_inbound", () => {
    expect(read("src/components/process-dashboard/DashboardSetup.tsx")).toContain('form.category === "support_inbound" && <InboundSourcePanel');
  });
  it("setup and page tolerate 200 data:null for an unconfigured process (no catch-404 path)", () => {
    const setup = read("src/components/process-dashboard/DashboardSetup.tsx");
    expect(setup).not.toMatch(/admin\/configs\/[^\n]*catch \{ return null; \}/);
  });
});

describe("breadcrumb label registry", () => {
  const Crumb = ({ href }: { href: string }) => <span>{useBreadcrumbLabels().get(href) ?? "raw"}</span>;
  it("a registered label replaces the raw id until cleared", () => {
    const href = "/performance/process-dashboard/abc";
    expect(renderToStaticMarkup(<Crumb href={href} />)).toContain("raw");
    setBreadcrumbLabel(href, "  Acme Support ");
    expect(renderToStaticMarkup(<Crumb href={href} />)).toContain("Acme Support");
    setBreadcrumbLabel(href, null);
    expect(renderToStaticMarkup(<Crumb href={href} />)).toContain("raw");
  });
  it("TopBar prefers a registered page label and the dashboard registers one", () => {
    expect(read("src/components/layout/TopBar.tsx")).toContain("pageLabels.get(crumb.href) ||");
    expect(read("src/components/process-dashboard/ProcessDashboard.tsx")).toContain("useBreadcrumbLabel(`/performance/process-dashboard/${processId}`");
  });
});
