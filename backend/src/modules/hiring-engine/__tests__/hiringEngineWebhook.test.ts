import { describe, expect, it } from "vitest";
import { parseWhatsAppWebhook } from "../he-webhook-parse.js";

const wrap = (value: unknown) => ({ entry: [{ changes: [{ value }] }] });

describe("parseWhatsAppWebhook", () => {
  it("typed text, template button and interactive reply", () => {
    const r = parseWhatsAppWebhook(wrap({ messages: [
      { from: "919876543210", id: "a", text: { body: "haan aaunga" } },
      { from: "919876543210", id: "b", button: { text: "Reschedule", payload: "x" } },
      { from: "919876543211", id: "c", interactive: { button_reply: { title: "Nahi aa paunga" } } },
    ] }));
    expect(r.inbound.map((m) => m.text)).toEqual(["haan aaunga", "Reschedule", "Nahi aa paunga"]);
  });
  it("statuses incl. failure reason; ignores unknown status", () => {
    const r = parseWhatsAppWebhook(wrap({ statuses: [
      { id: "m1", status: "delivered" }, { id: "m2", status: "failed", errors: [{ title: "Re-engagement" }] }, { id: "m3", status: "weird" } ] }));
    expect(r.statuses).toEqual([{ id: "m1", status: "delivered", error: undefined }, { id: "m2", status: "failed", error: "Re-engagement" }]);
  });
  it("garbage -> empty", () => {
    expect(parseWhatsAppWebhook(null)).toEqual({ inbound: [], statuses: [] });
    expect(parseWhatsAppWebhook({ entry: "x" })).toEqual({ inbound: [], statuses: [] });
  });
});
