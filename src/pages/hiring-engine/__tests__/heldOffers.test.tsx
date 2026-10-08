/** Held offers list inside the Follow-up panel: pure model + static markup (node env). Opening the <details> needs the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn() } }));

import { FollowupPanelView, type PanelData } from "../command/FollowupPanel";
import { ageText, heldLine, heldState, heldTitle, whyText, type HeldOffer, type HeldOffers } from "../command/heldOffersModel";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const offer = (over: Partial<HeldOffer> = {}): HeldOffer => ({
  id: "h1", name: "Asha", mobileMasked: "xxxxxx3210", requisitionId: "q2", requisitionCode: "RQ-2", sourceType: "meta_live", status: "held_other_offer",
  heldFor: { requisitionCode: "RQ-1", why: "already_offered" }, qualifiedAt: "2026-10-01T09:00:00Z", ...over,
});
const held = (over: Partial<HeldOffers> = {}): HeldOffers => ({ enabled: true, rows: [offer(), offer({ id: "h2", name: "Ravi", mobileMasked: "xxxxxx1111" })], truncated: false, partial: false, ...over });
const data = (h: HeldOffers | null | undefined): PanelData => ({
  status: { mode: "live", callFiles: [], report: { running: true, last: null } },
  summary: { mode: "live", data: [{ sourceType: "meta_live", total: 10, open: 6, stopped: 4 }] }, attention: [], sources: null, held: h, failed: [],
});
const noop = () => undefined;
const view = (d: PanelData) => renderToStaticMarkup(<FollowupPanelView expanded loading={false} error={null} data={d} onToggle={noop} onReload={noop} onRetry={noop} onMarkCalled={noop} />);
const group = (html: string) => html.slice(html.indexOf("<details"), html.indexOf("</details>"));

describe("whyText / heldLine / ageText", () => {
  it.each([
    ["already_offered", "already offered"], ["nearer", "nearer branch"], ["higher_score", "better match"], ["more_urgent", "fewer seats left"], ["earlier", "qualified earlier"],
  ] as const)("%s -> %s", (w, t) => expect(whyText(w)).toBe(t));
  it("heldLine names the requisition holding the offer and the reason", () => {
    expect(heldLine({ heldFor: { requisitionCode: "RQ-12", why: "nearer" } })).toBe("Held for RQ-12 (nearer branch)");
  });
  it("age in minutes, hours and days; bad or future times give a dash", () => {
    expect([ageText("2026-10-08T11:30:00Z", NOW), ageText("2026-10-08T09:00:00Z", NOW), ageText("2026-10-04T12:00:00Z", NOW)]).toEqual(["30 min ago", "3 h ago", "4 days ago"]);
    expect([ageText("nope", NOW), ageText("2026-10-09T12:00:00Z", NOW), ageText(undefined, NOW)]).toEqual(["–", "–", "–"]);
  });
});

describe("heldState", () => {
  it("null when not loaded; off, partial and empty are distinct honest states", () => {
    expect(heldState(null)).toBeNull();
    expect(heldState({ enabled: false, rows: [], truncated: false, partial: false })).toEqual({ kind: "off" });
    expect(heldState(held({ rows: [], partial: true }))).toEqual({ kind: "partial" });
    expect(heldState(held({ rows: [] }))).toEqual({ kind: "empty" });
  });
  it("masks a number that arrives unmasked", () => {
    const s = heldState(held({ rows: [offer({ mobileMasked: "9876543210" })] }), NOW);
    expect(s).toMatchObject({ kind: "list", rows: [{ mobile: "xxxxxx3210" }] });
  });
});

describe("Follow-up panel: held offers", () => {
  it("two held rows: heading with (2), masked mobile, requisition, reason line, age; no button inside the group", () => {
    const html = renderToStaticMarkup(<FollowupPanelView expanded loading={false} error={null} data={data(held())} onToggle={noop} onReload={noop} onRetry={noop} onMarkCalled={noop} />);
    const g = group(html);
    expect(g).toContain(heldTitle(2));
    expect(g).toContain("Held: another offer is in progress (2)");
    expect(g).toContain("xxxxxx3210");
    expect(g).toContain("(RQ-2)");
    expect(g).toContain("Held for RQ-1 (already offered)");
    expect(g).toMatch(/Qualified .* ago/);
    expect(g).not.toContain("<button");
    expect(g).not.toContain(" open");  // collapsed by default
    expect(g).toContain("<svg");
    expect(html).not.toMatch(/\d{10}/);
  });
  it("enabled false shows only the honest off sentence, no group", () => {
    const html = view(data({ enabled: false, rows: [], truncated: false, partial: false }));
    expect(html).toContain("Best-offer holding is off");
    expect(html).not.toContain("<details");
  });
  it("empty and partial say so; a failed load shows the panel partial banner and no held group", () => {
    expect(view(data(held({ rows: [] })))).toContain("no one is waiting for another offer");
    expect(view(data(held({ rows: [], partial: true })))).toContain("could not be read just now");
    const failed = view({ ...data(null), failed: ["the held offers"] });
    expect(failed).toContain("could not load the held offers");
    expect(failed).not.toContain("<details");
  });
  it("a truncated list says so", () => expect(view(data(held({ truncated: true })))).toContain("more are held"));
  it("data without the held field (older callers) renders nothing for it", () => expect(view(data(undefined))).not.toContain("Held"));
});
