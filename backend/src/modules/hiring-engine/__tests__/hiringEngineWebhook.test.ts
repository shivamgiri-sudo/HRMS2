import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordInboundReply, recordDeliveryStatus, logInfo } = vi.hoisted(() => ({ recordInboundReply: vi.fn(), recordDeliveryStatus: vi.fn(), logInfo: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(), query: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { info: logInfo, warn: vi.fn(), error: vi.fn() } }));
vi.mock("../he-secrets.service.js", () => ({ webhookToken: async () => ({ token: "tok-123", source: "env" }) }));
vi.mock("../he-ingest.service.js", () => ({ recordInboundReply, recordDeliveryStatus, recordEmailEvent: vi.fn(), recordVoiceResult: vi.fn() }));
vi.mock("../he-voice.service.js", () => ({ loadToolResult: vi.fn(), toolNextSlot: vi.fn(), toolReportResult: vi.fn() }));
vi.mock("../he-bulk-call.service.js", () => ({ completeBulkJob: vi.fn() }));
vi.mock("../he-intake.service.js", () => ({ ingestCandidates: vi.fn() }));
vi.mock("../he-call-ref.service.js", () => ({ matchForRef: vi.fn() }));
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn() }));

import { parseWhatsAppWebhook } from "../he-webhook-parse.js";
import { heWebhookRouter } from "../he-webhook.routes.js";

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

const MSG = { from: "919876543210", id: "wamid.1", text: { body: "STOP" } };
const ST = { id: "wamid.2", status: "failed", errors: [{ code: 131026, title: "Message undeliverable" }] };

describe("parseWhatsAppWebhook shapes", () => {
  const expected = { inbound: [{ from: "919876543210", id: "wamid.1", text: "STOP" }], statuses: [{ id: "wamid.2", status: "failed", error: "(#131026) Message undeliverable" }] };
  const value = { messages: [MSG], statuses: [ST] };
  it("standard Meta envelope", () => {
    expect(parseWhatsAppWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ value }] }] })).toEqual(expected);
  });
  it("bare value, wrapped value and array of payloads", () => {
    expect(parseWhatsAppWebhook(value)).toEqual(expected);
    expect(parseWhatsAppWebhook({ value })).toEqual(expected);
    expect(parseWhatsAppWebhook([{ entry: [{ changes: [{ value }] }] }])).toEqual(expected);
    expect(parseWhatsAppWebhook([{ changes: [{ value }] }])).toEqual(expected);
  });
  it("error without a code keeps the title", () => {
    expect(parseWhatsAppWebhook(wrap({ statuses: [{ id: "x", status: "failed", errors: [{ title: "Boom" }] }] })).statuses[0].error).toBe("Boom");
  });
  it("quick-reply button text", () => {
    expect(parseWhatsAppWebhook(wrap({ messages: [{ from: "91", id: "b", type: "button", button: { text: "Yes, I'll come" } }] })).inbound[0].text).toBe("Yes, I'll come");
  });
  it("malformed nesting never throws", () => {
    for (const b of [undefined, 5, "x", [null, 1, "a"], { entry: [null, { changes: [null, 3] }] }, { messages: [null, 7], statuses: ["a"] }]) {
      expect(() => parseWhatsAppWebhook(b)).not.toThrow();
    }
  });
});

describe("/api/he-hook/whatsapp", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/he-hook", heWebhookRouter);
  beforeEach(() => { recordInboundReply.mockReset().mockResolvedValue({ leadId: "l1", intent: "stop" }); recordDeliveryStatus.mockReset(); logInfo.mockReset(); });

  it("bare-value body records the inbound STOP once and answers 200", async () => {
    const r = await request(app).post("/api/he-hook/whatsapp?token=tok-123").send({ messages: [MSG] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ inbound: 1, statuses: 0 });
    expect(recordInboundReply).toHaveBeenCalledTimes(1);
    expect(recordInboundReply).toHaveBeenCalledWith({ mobile: "919876543210", text: "STOP", providerMessageId: "wamid.1" });
  });
  it("wrong or missing token is 403 and processes nothing", async () => {
    expect((await request(app).post("/api/he-hook/whatsapp?token=nope").send({ messages: [MSG] })).status).toBe(403);
    expect((await request(app).post("/api/he-hook/whatsapp").send({ messages: [MSG] })).status).toBe(403);
    expect(recordInboundReply).not.toHaveBeenCalled();
  });
  it("unknown body shape answers 200 inbound 0 and logs key names only", async () => {
    const r = await request(app).post("/api/he-hook/whatsapp").set("x-he-token", "tok-123").send({ weird: { phone: "919876543210" }, other: "STOP" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ inbound: 0, statuses: 0 });
    expect(recordInboundReply).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(logInfo.mock.calls[0]);
    expect(logged).toContain("weird");
    expect(logged).not.toContain("919876543210");
    expect(logged).not.toContain("STOP");
  });
  it("Meta handshake answers the challenge only for the right verify token", async () => {
    const ok = await request(app).get("/api/he-hook/whatsapp").query({ "hub.mode": "subscribe", "hub.verify_token": "tok-123", "hub.challenge": "c-42" });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe("c-42");
    expect((await request(app).get("/api/he-hook/whatsapp").query({ "hub.mode": "subscribe", "hub.verify_token": "bad", "hub.challenge": "c" })).status).toBe(403);
    expect((await request(app).get("/api/he-hook/whatsapp").query({ "hub.challenge": "c" })).status).toBe(403);
    expect((await request(app).get("/api/he-hook/whatsapp").query({ "hub.mode": "unsubscribe", "hub.verify_token": "tok-123", "hub.challenge": "c" })).status).toBe(403);
  });
});
