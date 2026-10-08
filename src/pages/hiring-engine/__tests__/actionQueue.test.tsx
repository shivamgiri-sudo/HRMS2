/** Act now panel: pure model + static markup (node env). Tap behaviour (tel on Android/iOS, WhatsApp anchor focus) needs the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)) } }));

vi.mock("@/hooks/useUserRole", () => ({ useHasRole: vi.fn(() => true) }));

import ActionQueuePanel, { ActionQueueView, type ActionViewProps } from "../command/ActionQueuePanel";
import { sectionParts, DriveCommandView } from "../command/DriveCommandCenter";
import {
  ACTION_EMPTY, ACTION_NOTE, ACTION_TRUNCATED, KIND_LABEL, REFRESH_FAILED, actionQueuePath, queueKnownOn, queueTotal, rememberQueueEnabled, resetQueueMemory, contactErrorText, contactPath, driveDayText, filterItems, recruiterText, safeHref,
} from "../command/actionQueueModel";
import { defaultFilters } from "../command/driveCommandModel";
import type { ActionItem, ActionKind, ActionQueue } from "../command/driveCommandTypes";

const item = (o: Partial<ActionItem> = {}): ActionItem => ({
  id: "replied_not_confirmed:match:m1", kind: "replied_not_confirmed", reason: "Replied but has not confirmed the slot", ageMinutes: 180, ageText: "3 h", suggested: "whatsapp",
  ref: "match:m1", leadId: "l1", name: "Asha", mobileMasked: "xxxxxx3210", requisitionId: "r1", requisitionCode: "RQ-1", branch: "Pune", driveDate: "2026-10-14",
  recruiter: { name: "Kiran", basis: "suggested" }, ...o,
});
const counts = (o: Partial<Record<ActionKind, number>> = {}): ActionQueue["counts"] => ({ replied_not_confirmed: 0, confirmed_no_reminder: 0, no_show_recovery: 0, wa_failed: 0, high_score_not_reached: 0, ...o });
const queue = (o: Partial<ActionQueue> = {}): ActionQueue => ({
  enabled: true, generatedAt: "2026-10-14T06:00:00Z", truncated: false, partial: false, failedSections: [],
  items: [item(), item({ id: "wa_failed:match:m2", kind: "wa_failed", ref: "match:m2", name: "Ravi", mobileMasked: "xxxxxx1111", leadId: null }), item({ id: "high_score_not_reached:match:m3", kind: "high_score_not_reached", ref: "match:m3", name: "Meena", mobileMasked: "xxxxxx2222" })],
  counts: counts({ replied_not_confirmed: 1, wa_failed: 1, high_score_not_reached: 1 }), ...o,
});
const noop = () => undefined;
const html = (data: ActionQueue | null, o: Partial<ActionViewProps> = {}) =>
  renderToStaticMarkup(<ActionQueueView data={data} loading={false} error={null} kind="all" onKind={noop} onCall={noop} onWhatsApp={noop} onOpen360={noop} onRetry={noop} {...o} />);

describe("model", () => {
  it("path carries the requisition and branch filters only", () => {
    expect(actionQueuePath({ ...defaultFilters(new Date("2026-10-14T00:00:00Z")), from: "2026-10-01", to: "2026-10-14", requisitionId: null, branch: "Pune & Co" })).toBe("/api/he/action-queue?branch=Pune+%26+Co");
    expect(actionQueuePath({ ...defaultFilters(new Date("2026-10-14T00:00:00Z")), requisitionId: null, branch: null })).toBe("/api/he/action-queue");
    expect(contactPath("match:m1", "tel")).toBe("/api/he/action-queue/contact?ref=match%3Am1&kind=tel");
  });
  it("kind labels, filter, recruiter text, error text", () => {
    expect(Object.values(KIND_LABEL)).toEqual(["Replied, not confirmed", "Confirmed, no reminder", "No-show recovery", "WhatsApp failed", "Strong match not reached"]);
    const items = queue().items;
    expect(filterItems(items, "all")).toHaveLength(3);
    expect(filterItems(items, "wa_failed").map((i) => i.name)).toEqual(["Ravi"]);
    expect(recruiterText({ name: "Asha", basis: "suggested" })).toBe("Suggested: Asha");
    expect(recruiterText({ name: "Asha", basis: "assigned" })).toBe("Assigned: Asha");
    expect(recruiterText({ name: null, basis: "none" })).toBe("No recruiter found");
    expect(contactErrorText({ status: 403 })).toBe("Only HR can open contact details");
    expect(contactErrorText({ status: 404 })).toBe("This candidate is no longer visible to you; reload");
    expect(contactErrorText(new Error("x"))).toBe("Could not open the contact; try again");
  });
  it("links are used only in the exact server shape", () => {
    expect(safeHref("tel", "tel:+919876543210")).toBe("tel:+919876543210");
    expect(safeHref("whatsapp", "https://wa.me/919876543210")).toBe("https://wa.me/919876543210");
    for (const bad of ["javascript:alert(1)", "tel:+91987654321", "tel:+919876543210x", "https://evil.test/919876543210", null, 5]) expect(safeHref("tel", bad)).toBeNull();
    expect(safeHref("whatsapp", "tel:+919876543210")).toBeNull();
  });
  it("drive day text", () => { expect(driveDayText("2026-10-14")).toBe("Wed 14 Oct"); expect(driveDayText(null)).toBe("–"); });
});

describe("ActionQueueView markup", () => {
  it("three items: heading, labelled Call buttons, chips, note, no full numbers or tel links", () => {
    const h = html(queue());
    expect(h).toContain("Act now (3)");
    expect(h.match(/>Call</g)).toHaveLength(3);
    expect(h).toContain('aria-label="Call Asha"');
    expect(h.match(/aria-label="Call [^"]+"/g)).toHaveLength(3);
    expect(h).toContain("focus-visible:ring-2");
    expect(h).toContain('aria-pressed="true"');
    expect(h).toContain('aria-pressed="false"');
    expect(h).toContain(ACTION_NOTE);
    expect(h).toContain("waiting 3 h");
    expect(h).toContain("Suggested: Kiran");
    expect(h).toContain("xxxxxx3210");
    expect(h).not.toMatch(/\d{10}/);
    expect(h).not.toContain('href="tel:');
    expect(h.match(/Open 360 for/g)).toHaveLength(2); // Ravi has no lead id
    expect(h).toContain("<ul");
    expect(h).toContain('role="status"');
  });
  it("a kind filter narrows the list", () => {
    const h = html(queue(), { kind: "wa_failed" });
    expect(h).toContain("Ravi");
    expect(h).not.toContain("Asha");
  });
  it("the WhatsApp anchor replaces the button for the fetched ref", () => {
    const h = html(queue(), { wa: { ref: "match:m1", href: "https://wa.me/919876543210" } });
    expect(h).toContain('target="_blank"');
    expect(h).toContain('rel="noopener noreferrer"');
    expect(h).toContain("Open WhatsApp chat");
  });
  it("off renders nothing; null renders nothing; loading is a reserved skeleton", () => {
    expect(html({ ...queue(), enabled: false })).toBe("");
    expect(html(null)).toBe("");
    const l = html(null, { loading: true });
    expect(l).toContain('aria-busy="true"');
    expect(l).toContain("height:160px");
  });
  it("empty, truncated, partial, error and contact-error states are stated", () => {
    expect(html(queue({ items: [], counts: counts() }))).toContain(ACTION_EMPTY);
    expect(html(queue({ truncated: true }))).toContain(ACTION_TRUNCATED);
    const p = html(queue({ partial: true, failedSections: ["wa_failed"] }));
    expect(p).toContain("Partial result");
    expect(p).toContain("WhatsApp failed");
    const e = html(null, { error: "Request failed" });
    expect(e).toContain('role="alert"');
    expect(e).toContain("Retry");
    expect(html(queue(), { contactError: "Only HR can open contact details" })).toContain("Only HR can open contact details");
  });
  it("the stateful panel starts as the loading skeleton once the switch is known on, and as nothing before", () => {
    resetQueueMemory();
    expect(renderToStaticMarkup(<ActionQueuePanel filters={defaultFilters(new Date("2026-10-14T06:00:00Z"))} />)).toBe("");
    rememberQueueEnabled(true);
    expect(renderToStaticMarkup(<ActionQueuePanel filters={defaultFilters(new Date("2026-10-14T06:00:00Z"))} />)).toContain('aria-busy="true"');
    resetQueueMemory();
  });
});

describe("layout stability, totals, refresh errors, roles", () => {
  it("remembers an off answer in-session and draws nothing while loading; remembered on keeps the skeleton", () => {
    resetQueueMemory();
    expect(queueKnownOn()).toBe(false);
    rememberQueueEnabled(false);
    expect(queueKnownOn()).toBe(false);
    expect(renderToStaticMarkup(<ActionQueuePanel filters={defaultFilters(new Date("2026-10-14T06:00:00Z"))} />)).toBe("");
    rememberQueueEnabled(true);
    expect(queueKnownOn()).toBe(true);
    expect(renderToStaticMarkup(<ActionQueuePanel filters={defaultFilters(new Date("2026-10-14T06:00:00Z"))} />)).toContain('aria-busy="true"');
    resetQueueMemory();
  });
  it("view draws nothing while loading when not expected on", () => {
    expect(html(null, { loading: true, expectOn: false })).toBe("");
  });
  it("title and All chip use the sum of counts; truncated says first 100", () => {
    const q = queue({ truncated: true, counts: counts({ replied_not_confirmed: 150, wa_failed: 80 }) });
    expect(queueTotal(q)).toBe(230);
    const h = html(q);
    expect(h).toContain("Act now (230, showing first 100)");
    expect(h).toContain("All, 230 people");
    expect(html(queue())).toContain("Act now (3)");
  });
  it("a refresh error keeps the list and shows a status with Retry", () => {
    const h = html(queue(), { error: "Request failed" });
    expect(h).toContain(REFRESH_FAILED);
    expect(h).toContain("Asha");
    expect(h).toContain("Retry");
  });
  it("the selected chip carries a check icon besides aria-pressed", () => {
    const sel = html(queue(), { kind: "wa_failed" });
    expect(sel.match(/lucide-check/g)).toHaveLength(1);
    expect(html(queue()).match(/lucide-check/g)).toHaveLength(1);
  });
  it("roles without write see no Call or WhatsApp buttons", () => {
    const h = html(queue(), { canContact: false });
    expect(h).not.toContain(">Call<");
    expect(h).not.toContain("WhatsApp Asha");
    expect(h).toContain("Open 360 for Asha");
  });
  it("partial reason is shown", () => {
    expect(html(queue({ partial: true, failedSections: ["recruiters"], partialReason: "Recruiter suggestions were looked up for the first 20 of 25 branches" }))).toContain("first 20 of 25 branches");
  });
  it("summary children render before the skeleton and the failed block", () => {
    const f = defaultFilters(new Date("2026-10-14T06:00:00Z"));
    const h = renderToStaticMarkup(
      <DriveCommandView section="summary" filters={f} analytics={null} loading={true} error={null} onSection={noop} onFilters={noop} onRetry={noop} requisitions={[]} branches={[]}><p>ALWAYS-MARK</p></DriveCommandView>);
    expect(h.indexOf("ALWAYS-MARK")).toBeGreaterThan(-1);
    expect(h.indexOf("ALWAYS-MARK")).toBeLessThan(h.indexOf("Loading drive analytics"));
    const e = renderToStaticMarkup(
      <DriveCommandView section="summary" filters={f} analytics={null} loading={false} error="boom" onSection={noop} onFilters={noop} onRetry={noop} requisitions={[]} branches={[]}><p>ALWAYS-MARK</p></DriveCommandView>);
    expect(e.indexOf("ALWAYS-MARK")).toBeLessThan(e.indexOf("Could not load drive analytics"));
  });
});

describe("Command Center wiring", () => {
  const f = defaultFilters(new Date("2026-10-14T06:00:00Z"));
  it("Summary keeps five tabs and draws the panel above the gated charts", () => {
    rememberQueueEnabled(true);
    const p = sectionParts("summary", null, undefined, undefined, undefined, 0, f);
    const h = renderToStaticMarkup(
      <DriveCommandView section="summary" filters={f} analytics={null} loading={false} error={null} onSection={noop} onFilters={noop} onRetry={noop} requisitions={[]} branches={[]} gated={<p>GATED-MARK</p>}>{p.always}</DriveCommandView>);
    expect(h.match(/role="tab"/g)).toHaveLength(5);
    expect(h.indexOf("aria-busy")).toBeGreaterThan(-1);
    expect(h.indexOf('aria-label="Act now"')).toBeGreaterThan(-1);
    expect(h.indexOf('aria-label="Act now"')).toBeLessThan(h.indexOf("GATED-MARK"));
  });
});
