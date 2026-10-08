/** Responses tab, review queue: static markup (node env). Clicks, focus order and polling need the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({ useWorkforceAccess: () => ({ roleKeys: [], isResolved: true }) }));

import { ChannelCounts, FiltersBar, ResponsesView, type FilterOptions } from "../responses/ResponsesTab";
import { QueueView } from "../responses/ResponseQueue";
import { defaultResponseFilters, type ResponseRow, type ResponseSummary } from "../responses/responsesModel";

const NOW = new Date("2026-10-08T06:30:00Z");
const noop = () => undefined;
const opts: FilterOptions = { campaigns: [{ id: "C1", label: "AHM Sales" }], requisitions: [{ id: "R1", label: "REQ-1 Agent" }], drives: [] };
const row = (o: Partial<ResponseRow> = {}): ResponseRow => ({
  id: 7, occurredAt: "2026-10-08 10:00:00", channel: "whatsapp", mode: "text", answer: "question", status: "needs_review", suggested: "confirm", confidence: 0.6,
  person: { name: "Asha V.", mobileMasked: "xxxxxx3210" }, leadId: "L1", matchId: null, requisitionId: "R1", requisitionCode: "REQ-1", campaignName: "AHM Sales",
  driveType: "meta_live", driveId: null, driveDate: null, slotAt: null, handledBy: "system", handledAt: null, conflict: false, dedupeOf: null, textPreview: "what is the salary?", ...o,
});
const view = (p: Partial<React.ComponentProps<typeof ResponsesView>> = {}) => renderToStaticMarkup(
  <ResponsesView filters={defaultResponseFilters(NOW)} options={opts} summary={null} list={null} loading={false} error={null} updatedAt="12:00:00"
    onFilters={noop} onMore={noop} onOpen={noop} onRefresh={noop} {...p} />);

describe("ResponsesView", () => {
  it("honest empty state, distinct for filtered and unfiltered", () => {
    expect(view({ list: { rows: [], nextCursor: null } })).toContain("No answers recorded in this range yet.");
    expect(view({ list: { rows: [], nextCursor: null }, filters: { ...defaultResponseFilters(NOW), channel: "email" } })).toContain("No answer matches these filters in this range.");
  });
  it("rows: masked mobile only, channel and answer as icon + word, conflict and duplicate said in words, the name opens the timeline", () => {
    const html = view({ list: { rows: [row(), row({ id: 8, channel: "web", answer: "decline", status: "applied", conflict: true, dedupeOf: 3, person: { name: "Ravi S.", mobileMasked: "xxxxxx1111" } })], nextCursor: "c" } });
    expect(html).not.toMatch(/\d{10}/);
    expect(html).toContain("xxxxxx3210");
    expect(html).toContain("WhatsApp");
    expect(html).toContain("Email button");
    expect(html).toContain("Cannot come");
    expect(html).toContain("Conflicts with an earlier yes");
    expect(html).toContain("Already confirmed earlier");
    expect(html).toContain('aria-label="Timeline of Asha V."');
    expect(html).toContain("Show older answers");
    expect((html.match(/<svg/g) ?? []).length).toBeGreaterThan(4); // icons ride along with the words
  });
  it("loading skeleton has reserved height; an error is an alert", () => {
    expect(view({ loading: true })).toContain('aria-label="Loading the answers"');
    expect(view({ error: "boom" })).toContain('role="alert"');
  });
  it("queue and next drive blocks come first", () => {
    const html = view({ queue: <div id="Q">queue</div>, nextDrive: <div id="N">next</div> });
    expect(html.indexOf('id="Q"')).toBeLessThan(html.indexOf('id="N"'));
    expect(html.indexOf('id="N"')).toBeLessThan(html.indexOf("All answers"));
  });
});

describe("FiltersBar", () => {
  it("every control has a label; touch targets are 44px below sm", () => {
    const html = renderToStaticMarkup(<FiltersBar f={defaultResponseFilters(NOW)} options={opts} onChange={noop} />);
    for (const id of ["rf-from", "rf-to", "rf-campaign", "rf-req", "rf-type", "rf-drive", "rf-channel", "rf-answer", "rf-status", "rf-q"]) expect(html).toContain(`for="${id}"`);
    expect(html).toContain("min-h-11");
    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain("AHM Sales");
  });
});

describe("ChannelCounts", () => {
  it("zeros are shown, not hidden; no rate when nothing was read", () => {
    const html = renderToStaticMarkup(<ChannelCounts summary={null} />);
    expect(html).toContain("Calling file");
    expect(html).toContain("not available");
  });
  it("rates with their counts", () => {
    const s = { byChannel: {}, rateByChannel: { email: { contacted: 4, responded: 1, rate: 0.25 }, whatsapp: { contacted: 0, responded: 0, rate: null }, voice_bot: { contacted: 3, responded: 0, rate: 0 } }, rateByType: {}, byDrive: [] } as unknown as ResponseSummary;
    const html = renderToStaticMarkup(<ChannelCounts summary={s} />);
    expect(html).toContain("Email 25% (1 of 4)");
    expect(html).toContain("WhatsApp none contacted");
  });
});

describe("QueueView", () => {
  const data = { rows: [row()], counts: { total: 1, under1h: 0, h1to4: 1, h4to24: 0, over24h: 0 }, oldestAt: "2026-10-08 10:00:00" };
  const q = (p: Partial<React.ComponentProps<typeof QueueView>> = {}) => renderToStaticMarkup(
    <QueueView data={data} loading={false} error={null} canWrite busyId={null} message={null} nowMs={NOW.getTime()} onAction={noop} onOpen={noop} onRetry={noop} {...p} />);
  it("write role: the five one-click classes; text, suggestion and confidence are shown", () => {
    const html = q();
    for (const l of ["Will come", "Cannot come", "Another time", "Question (no change)", "Ignore"]) expect(html).toContain(`aria-label="${l}: Asha V."`);
    expect(html).toContain("what is the salary?");
    expect(html).toContain("Looks like");
    expect(html).toContain("60% sure");
    expect(html).toContain("Replies waiting for HR (1)");
    expect(html).toContain("2 h ago");
    expect(html).toContain("never applied automatically");
  });
  it("view-only role (ceo): no write button, the timeline stays", () => {
    const html = q({ canWrite: false });
    expect(html).not.toContain("Cannot come: Asha V.");
    expect(html).not.toContain("Ignore");
    expect(html).toContain('aria-label="Timeline of Asha V."');
  });
  it("empty queue says so; a failed read offers Retry", () => {
    expect(q({ data: { rows: [], counts: { total: 0, under1h: 0, h1to4: 0, h4to24: 0, over24h: 0 }, oldestAt: null } })).toContain("No reply is waiting");
    const err = q({ data: null, error: "boom" });
    expect(err).toContain('role="alert"');
    expect(err).toContain("Retry");
  });
});
