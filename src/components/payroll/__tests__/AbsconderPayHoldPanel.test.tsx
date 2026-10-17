/**
 * The absconder salary hold panel: what each state says and which buttons each person gets.
 * Pure view rendered to static markup (this repo's frontend tests have no click simulation), plus a
 * contract check that the real source calls the endpoints the backend serves.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AbsconderPayHoldView, ARREARS_NOTE, COPY, type HoldView, type HoldState } from "../AbsconderPayHoldPanel";

const none = { canRequestHold: false, canDecideRequest: false, canPlaceHold: false, canRelease: false };
const mk = (state: HoldState, flags: Partial<HoldView> = {}, extra: Partial<HoldView> = {}): HoldView => ({
  state, held: state === "held", route: null, lastEvent: null, ...none, ...flags, ...extra,
});
const html = (v: HoldView) =>
  renderToStaticMarkup(<AbsconderPayHoldView exitId="x1" view={v} reason="" busy={false} onReason={() => {}} onAct={() => {}} />);
const buttons = (s: string) => [...s.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim());

describe("states", () => {
  it("says salary is paid as normal by default", () => {
    expect(html(mk("not_held"))).toContain("Salary is paid as normal");
  });
  it("says HELD at 0 days when held", () => {
    expect(html(mk("held"))).toContain("Salary HELD at 0 days");
  });
  it("says waiting for branch Payroll HR when requested", () => {
    expect(html(mk("hold_requested"))).toContain("waiting for branch Payroll HR");
  });
  it("says a request was declined and salary is as normal", () => {
    expect(html(mk("request_rejected"))).toContain("declined");
  });
  it("says attendance days are restored once released, and which route paid it", () => {
    expect(html(mk("released", {}, { route: "payroll" }))).toContain("Paid through the open payroll run");
    expect(html(mk("released", {}, { route: "fnf" }))).toContain("paid through the F&amp;F");
  });
  it("has copy for every state", () => {
    for (const s of ["not_held", "hold_requested", "request_rejected", "held", "released"] as HoldState[]) expect(COPY[s].title).toBeTruthy();
  });
});

describe("closed-month warning before release", () => {
  it("warns Payroll HR with the months and the PF/ESIC arrears note", () => {
    const out = html(mk("held", { canRelease: true }, { releaseImpact: { closedMonths: ["2026-09", "2026-08"] } }));
    expect(out).toContain('role="alert"');
    expect(out).toContain("2026-09, 2026-08");
    expect(out).toContain("already closed");
    expect(out).toContain("arrears");
  });
  it("shows no warning when nothing is closed, or to someone who cannot release", () => {
    expect(html(mk("held", { canRelease: true }, { releaseImpact: { closedMonths: [] } }))).not.toContain('role="alert"');
    expect(html(mk("held", {}, { releaseImpact: { closedMonths: ["2026-09"] } }))).not.toContain('role="alert"');
  });
  it("reminds again after a release that went through the F&F, not after one paid by payroll", () => {
    expect(html(mk("released", {}, { route: "fnf" }))).toContain("arrears");
    expect(html(mk("released", {}, { route: "payroll" }))).not.toContain("arrears");
    expect(ARREARS_NOTE).toMatch(/ESIC/);
  });
});

describe("who gets which button (decided by the server flags)", () => {
  it("the reporting manager only gets 'Request salary hold'", () => {
    expect(buttons(html(mk("not_held", { canRequestHold: true })))).toEqual(["Request salary hold"]);
  });
  it("Payroll HR on a request gets Approve and Decline, not Hold or Release", () => {
    expect(buttons(html(mk("hold_requested", { canDecideRequest: true, canPlaceHold: false })))).toEqual(["Approve hold", "Decline"]);
  });
  it("Payroll HR with nothing pending gets 'Hold salary'", () => {
    expect(buttons(html(mk("not_held", { canPlaceHold: true })))).toEqual(["Hold salary"]);
  });
  it("Payroll HR on a held employee gets 'Release hold'", () => {
    expect(buttons(html(mk("held", { canRelease: true })))).toEqual(["Release hold"]);
  });
  it("everyone else gets no buttons and no reason box", () => {
    for (const s of ["not_held", "hold_requested", "held", "released", "request_rejected"] as HoldState[]) {
      const out = html(mk(s));
      expect(buttons(out)).toEqual([]);
      expect(out).not.toContain("<textarea");
    }
  });
  it("shows the last note and keeps the reason box only when there is an action", () => {
    const out = html(mk("held", { canRelease: true }, { lastEvent: { action: "hold_placed", reason: "laptop not returned", at: "2026-10-07" } }));
    expect(out).toContain("laptop not returned");
    expect(out).toContain("<textarea");
  });
});

describe("wiring", () => {
  const src = readFileSync(resolve(process.cwd(), "src/components/payroll/AbsconderPayHoldPanel.tsx"), "utf8");
  it("calls the routes the backend serves", () => {
    expect(src).toContain('"/api/payroll/absconder-pay-release"');
    for (const p of ['"hold/request"', '"hold/approve"', '"hold/reject"', '"hold"', '"hold/release"']) expect(src).toContain(p);
  });
  it("refuses a reason under 15 characters before calling the server", () => {
    expect(src).toContain("reason.trim().length < 15");
  });
  it("is mounted for absconding exits in the exit drawer and the F&F screen", () => {
    expect(readFileSync(resolve(process.cwd(), "src/components/exit/NoticePeriodDrawer.tsx"), "utf8")).toContain("<AbsconderPayHoldPanel");
    expect(readFileSync(resolve(process.cwd(), "src/pages/NativeFullFinal.tsx"), "utf8")).toContain("<AbsconderPayHoldPanel");
  });
});
