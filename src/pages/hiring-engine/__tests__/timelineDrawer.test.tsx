/** Timeline: model + static markup (node env). Opening the drawer needs the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn() } }));

import { TimelineView } from "../responses/TimelineDrawer";
import { keyOf, timelineDays, timelinePath, type Timeline } from "../responses/timelineModel";

const T: Timeline = {
  person: { name: "Asha V.", mobileMasked: "xxxxxx3210" }, truncated: false,
  items: [
    { at: "2026-10-07 10:00:00", kind: "out", channel: "email", label: "Sent: he walkin invite", detail: "Invite (sent)" },
    { at: "2026-10-08 09:00:00", kind: "call", channel: "voice_bot", label: "Call: walkin confirmed yes", detail: "" },
    { at: "2026-10-07 12:00:01", kind: "response", channel: "whatsapp", label: "Answer: question (needs review)", detail: "text" },
    { at: "2026-10-07 12:00:00", kind: "in", channel: "whatsapp", label: "Reply", detail: "ok #" },
  ],
};

describe("timelineDays", () => {
  it("newest first, grouped by day, with a kind word and a channel word", () => {
    const d = timelineDays(T);
    expect(d.map((g) => [g.dayText, g.items.map((i) => `${i.time} ${i.kindWord} ${i.channelWord}`)])).toEqual([
      ["8 Oct", ["09:00 Call Voice bot"]],
      ["7 Oct", ["12:00 Answer WhatsApp", "12:00 Reply WhatsApp", "10:00 Sent Email"]],
    ]);
    expect(timelineDays(null)).toEqual([]);
  });
  it("paths by a response, match or lead id (never a mobile)", () => {
    expect(timelinePath({ responseId: 7 })).toBe("/api/he/responses/timeline?responseId=7");
    expect(timelinePath({ matchId: "M 1" })).toBe("/api/he/responses/timeline?matchId=M%201");
    expect(timelinePath({ leadId: "L1" })).toBe("/api/he/responses/timeline?leadId=L1");
    expect([keyOf({ responseId: 7 }), keyOf(null)]).toEqual(["r7", ""]);
  });
});

describe("TimelineView", () => {
  it("items in order with words (the meaning never rests on the icon)", () => {
    const html = renderToStaticMarkup(<TimelineView data={T} loading={false} error={null} />);
    const order = ["Call: walkin confirmed yes", "Answer: question (needs review)", "Reply", "Sent: he walkin invite"].map((s) => html.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('data-kind="call"');
    expect(html).not.toMatch(/\d{10}/);
  });
  it("empty, loading, error with retry, capped", () => {
    expect(renderToStaticMarkup(<TimelineView data={{ ...T, items: [] }} loading={false} error={null} />)).toContain("Nothing recorded for this person yet.");
    expect(renderToStaticMarkup(<TimelineView data={null} loading error={null} />)).toContain('aria-label="Loading the timeline"');
    const err = renderToStaticMarkup(<TimelineView data={null} loading={false} error="Not found in your branch" onRetry={() => undefined} />);
    expect(err).toContain("Not found in your branch");
    expect(err).toContain("Retry");
    expect(renderToStaticMarkup(<TimelineView data={{ ...T, truncated: true }} loading={false} error={null} />)).toContain("Showing the latest 300 items.");
  });
});
