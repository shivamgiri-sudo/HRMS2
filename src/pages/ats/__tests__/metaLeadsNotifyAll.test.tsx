/** Notify All on the server: pure helper (node env). The button itself and the row updates need the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NOTIFY_CHUNK, runNotifyAll, unnotifiedQualifiedIds } from "../metaNotifyAll";
import { BulkNotifyResult } from "../BulkNotifyResult";

const row = (id: string, o: Record<string, unknown> = {}) => ({ id, screeningResult: "qualified", notificationSentAt: null, ...o });

describe("Notify All", () => {
  it("picks the unnotified qualified leads only", () => {
    const rows = [row("a"), row("b", { notificationSentAt: "2026-10-08" }), row("c", { screeningResult: "disqualified" }), row("d")];
    expect(unnotifiedQualifiedIds(rows, new Set(["d"]))).toEqual(["a"]);
  });
  it("posts the ids to the server route in chunks and adds up sent / skipped / failed", async () => {
    const ids = Array.from({ length: NOTIFY_CHUNK + 3 }, (_, i) => `L${i}`);
    const post = vi.fn(async (_url: string, body: { leadIds: string[] }) => ({
      data: { results: body.leadIds.map((leadId, i) => ({ leadId, status: i === 0 ? "skipped" : "sent", reason: i === 0 ? "Already notified; pass force=true to re-send" : undefined })), counts: {} },
    }));
    const onSent = vi.fn();
    const r = await runNotifyAll(ids, post as never, onSent);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][0]).toBe("/api/meta/leads/notify-all");
    expect(post.mock.calls[0][1]).toEqual({ leadIds: ids.slice(0, NOTIFY_CHUNK) });
    expect(post.mock.calls.every((c) => !("force" in c[1]))).toBe(true);
    expect(r).toEqual({ sent: ids.length - 2, skipped: 2, failed: 0, reasons: { "Already notified; pass force=true to re-send": 2 }, failures: [], unavailable: false });
    expect(onSent).toHaveBeenCalledTimes(2);
  });
  it("a lost response re-reads the chunk: leads the server marked are sent, the rest failed with the reason; then it carries on", async () => {
    const chunk = Array.from({ length: NOTIFY_CHUNK }, (_, i) => `L${i}`);
    const post = vi.fn(async (url: string, body: { leadIds: string[] }) => {
      if (url.endsWith("/status")) return { data: { results: body.leadIds.map((leadId) => ({ leadId, notified: leadId === "L0" || leadId === "L1" })) } };
      if (body.leadIds.includes("L0")) throw Object.assign(new Error("Request timed out"), { status: 504 });
      return { data: { results: [{ leadId: "x", status: "sent" }] } };
    });
    const onSent = vi.fn();
    const r = await runNotifyAll([...chunk, "x"], post as never, onSent);
    expect(post.mock.calls.map((c) => c[0])).toEqual(["/api/meta/leads/notify-all", "/api/meta/leads/notify-all/status", "/api/meta/leads/notify-all"]);
    expect(onSent).toHaveBeenCalledWith(["L0", "L1"]);
    expect(r).toMatchObject({ sent: 3, failed: NOTIFY_CHUNK - 2, unavailable: false });
    expect(r.failures).toHaveLength(NOTIFY_CHUNK - 2);
    expect(r.failures[0]).toEqual({ leadId: "L2", reason: "No answer from the server (Request timed out); not marked as sent, check before notifying again" });
  });
  it("per-lead refusals (403 another branch, 404 unknown) are listed with their reasons", async () => {
    const post = vi.fn(async () => ({ data: { results: [{ leadId: "a", status: "sent" }, { leadId: "b", status: "failed", reason: "Not in your branch (403)" }, { leadId: "c", status: "failed", reason: "Lead not found (404)" }] } }));
    const r = await runNotifyAll(["a", "b", "c"], post as never, () => undefined);
    expect(r.failures).toEqual([{ leadId: "b", reason: "Not in your branch (403)" }, { leadId: "c", reason: "Lead not found (404)" }]);
    expect(r).toMatchObject({ sent: 1, failed: 2 });
  });
  it("the server has no Notify All route (404 on the route): stops, sends nothing more, says so", async () => {
    const post = vi.fn(async () => { throw Object.assign(new Error("Route not found: POST /api/meta/leads/notify-all"), { status: 404 }); });
    const ids = Array.from({ length: NOTIFY_CHUNK * 2 }, (_, i) => `L${i}`);
    const r = await runNotifyAll(ids, post as never, () => undefined);
    expect(post).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ sent: 0, failed: 0, unavailable: true });
    const html = renderToStaticMarkup(<BulkNotifyResult r={r} />);
    expect(html).toContain("Notify All is not available on this server yet");
  });
  it("lists each failed lead by name with its reason", () => {
    const html = renderToStaticMarkup(<BulkNotifyResult r={{ sent: 1, skipped: 0, failed: 2, reasons: {}, unavailable: false, failures: [{ leadId: "b", reason: "Not in your branch (403)" }, { leadId: "c", reason: "Lead not found (404)" }] }} names={{ b: "Asha Rao" }} />);
    expect(html).toContain("Asha Rao: Not in your branch (403)");
    expect(html).toContain("c: Lead not found (404)");
  });
  it("shows sent / skipped / failed as words with icons", () => {
    const html = renderToStaticMarkup(<BulkNotifyResult r={{ sent: 3, skipped: 2, failed: 1, reasons: { "Candidate opted out (STOP)": 2 }, failures: [], unavailable: false }} />);
    expect(html).toContain("3 sent");
    expect(html).toContain("2 skipped");
    expect(html).toContain("1 failed");
    expect(html).toContain("Candidate opted out (STOP)");
    expect(html).toContain("<svg");
  });
});
