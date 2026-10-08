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
    expect(r).toEqual({ sent: ids.length - 2, skipped: 2, failed: 0, reasons: { "Already notified; pass force=true to re-send": 2 } });
    expect(onSent).toHaveBeenCalledTimes(2);
  });
  it("a failed request counts its whole chunk as failed and carries on", async () => {
    const post = vi.fn().mockRejectedValueOnce(new Error("502")).mockResolvedValueOnce({ data: { results: [{ leadId: "x", status: "sent" }], counts: {} } });
    const ids = [...Array.from({ length: NOTIFY_CHUNK }, (_, i) => `L${i}`), "x"];
    expect(await runNotifyAll(ids, post as never, () => undefined)).toMatchObject({ sent: 1, failed: NOTIFY_CHUNK });
  });
  it("shows sent / skipped / failed as words with icons", () => {
    const html = renderToStaticMarkup(<BulkNotifyResult r={{ sent: 3, skipped: 2, failed: 1, reasons: { "Candidate opted out (STOP)": 2 } }} />);
    expect(html).toContain("3 sent");
    expect(html).toContain("2 skipped");
    expect(html).toContain("1 failed");
    expect(html).toContain("Candidate opted out (STOP)");
    expect(html).toContain("<svg");
  });
});
