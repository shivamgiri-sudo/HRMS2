/** Follow-up switches card: pure model + static markup (node env). Clicks, the confirm step and the picker need the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({ useUserRole: () => ({ data: { roles: ["ceo"] } }) }));

import { FollowupSwitchView, type ViewProps } from "../FollowupSwitchCard";
import { canEditSwitches, confirmFor, effectiveText, pickerOptions, putBody, type SwitchesView } from "../followupSwitchModel";

const off = { mode: "off", effective: "off" } as const;
const view = (over: Partial<SwitchesView> = {}): SwitchesView => ({
  ceiling: "live", killSwitch: false, sources: { meta_live: { ...off }, meta_old: { ...off }, he: { ...off } }, canary: [],
  caps: [{ prefix: "NOIDA-2", dailyMax: 50, usedToday: 3 }, { prefix: "AHMEDABAD", dailyMax: 30, usedToday: 0 }],
  budget: { max: 500, quality: "GREEN", used: 120 }, inbound: { lastInboundAt: null, inbound7d: 0, verified: false, acknowledged: false },
  counts: { meta_live: { enrolled: 3, reach: 1 }, meta_old: {}, he: {} }, ...over,
});
const noop = () => undefined;
const render = (p: Partial<ViewProps> = {}) => renderToStaticMarkup(
  <FollowupSwitchView data={view()} loading={false} error={null} canEdit busy={false} message={null} pending={null} requisitions={[]}
    onMode={noop} onConfirm={noop} onCancel={noop} onKill={noop} onInboundVerified={noop} onCap={noop} onAddCanary={noop} onRemoveCanary={noop} onRetry={noop} {...p} />);

describe("FollowupSwitchView", () => {
  it("renders three sources with Off by default", () => {
    const html = render();
    for (const l of ["Live Meta leads", "Old Meta data", "Hiring Engine pool"]) expect(html).toContain(l);
    expect((html.match(/<option value="off" selected="">Off<\/option>/g) ?? []).length).toBe(3);
  });
  it("effective mode shows 'Dry run (limited by server setting)' when the ceiling caps it", () => {
    expect(effectiveText("live", "dry_run", "dry_run")).toBe("Dry run (limited by server setting)");
    expect(effectiveText("live", "dry_run", "live")).toBe("Dry run (Pinbot inbound not verified)");
    const html = render({ data: view({ ceiling: "dry_run", sources: { meta_live: { mode: "live", effective: "dry_run" }, meta_old: { ...off }, he: { ...off } } }) });
    expect(html).toContain("Dry run (limited by server setting)");
  });
  it("choosing Live asks for confirmation and PUTs { mode: \"live\" }", () => {
    const c = confirmFor("meta_live", "live", { lastInboundAt: null, inbound7d: 0, verified: true, acknowledged: false });
    expect(c.needsAck).toBe(false);
    expect(putBody("live", false)).toEqual({ mode: "live" });
    expect(putBody("live", true)).toEqual({ mode: "live", acknowledgeInboundUnverified: true });
    expect(putBody("dry_run", true)).toEqual({ mode: "dry_run" });
    const html = render({ pending: { source: "meta_live", mode: "live" } });
    expect(html).toMatch(/role="alertdialog"[^>]*data-state="open"[^>]*tabindex="-1"/);
    expect(html).toContain('data-dialog-cancel=""');
    expect(html).toContain("Live Meta leads to Live");
    // inbound not verified: the owner must tick the risk box
    expect(html).toContain("I accept that Pinbot inbound is not verified");
  });
  it("table headers carry scope", () => {
    const html = render();
    expect(html).toContain('<th scope="col" class="py-1">Source</th>');
    expect(html).toContain('<th scope="col" class="py-1">Branch prefix</th>');
    expect(html).not.toMatch(/<th class=/);
  });
  it("kill switch shows its state in words with an icon, and the button flips it", () => {
    expect(render()).toContain("Sends running");
    const html = render({ data: view({ killSwitch: true }) });
    expect(html).toContain("All follow-up sends paused");
    expect(html).toContain("Resume sends");
  });
  it("canary picker lists only open requisitions not yet listed", () => {
    const reqs = [{ id: "r1", requisition_code: "REQ-1", branch_name: "NOIDA-2" }, { id: "r2", requisition_code: "REQ-2", branch_name: "AHMEDABAD" }];
    const v = view({ canary: [{ sourceType: "he", requisitionId: "r1", code: "REQ-1", branch: "NOIDA-2" }] });
    expect(pickerOptions(reqs, v, "he").map((r) => r.id)).toEqual(["r2"]);
    expect(pickerOptions(reqs, v, "meta_live").map((r) => r.id)).toEqual(["r1", "r2"]);
    const html = render({ data: v, requisitions: reqs });
    expect(html).toContain("REQ-1");
    expect(html).toContain("Remove REQ-1 from the he canary list");
  });
  it("CEO and HR see the card read-only", () => {
    expect(canEditSwitches(["ceo"])).toBe(false);
    expect(canEditSwitches(["hr", "admin"])).toBe(true);
    const html = render({ canEdit: false });
    expect(html).toContain("View only");
    expect(html).not.toMatch(/<select[^>]*id="fu-mode-meta_live"(?![^>]*disabled)/);
  });
  it("loading, error with retry, budget and inbound health", () => {
    expect(render({ data: null, loading: true })).toContain("aria-busy=\"true\"");
    const err = render({ data: null, error: "Could not load" });
    expect(err).toContain("Could not load");
    expect(err).toContain("Retry");
    const html = render();
    expect(html).toContain("120 of 500");
    expect(html).toContain("Not verified");
    expect(html).toContain("enrolled 3, reach 1");
  });
});
