import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Retry used to resend dispatch_log.body_preview as the message body.
 *
 * body_preview is a preview: it is written as .slice(0, 500) for the admin history screen. So
 * clicking Retry sent the first 500 characters, reported success, and set status='sent' — nothing
 * downstream could tell the employee had received half a message.
 *
 * Measured live 2026-08-16: all 947 email rows in dispatch_log sit at the limit, because a
 * rendered HTML mail always exceeds 500 characters. On the only channel that has ever delivered
 * anything (email: 916 sent; SMS and WhatsApp: 0 sent, ever), retry was therefore always
 * corrupting. SMS and WhatsApp bodies are all under the limit — 0 of 1,823 truncated — so the
 * refusal below is targeted, not a blanket disablement of the feature.
 *
 * A faithful re-render is impossible from the log: renderTemplate needs the original dto.data
 * context and only template_id, template_name and the recipient are stored. Refusing is the
 * honest answer; the caller is told to re-trigger the source event.
 */

const { mockExecute } = vi.hoisted(() => ({ mockExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: mockExecute } }));
vi.mock("../providers/provider.factory.js", () => ({ providerFactory: { getProviderAsync: vi.fn() } }));
vi.mock("../provider-config.service.js", () => ({ providerConfigService: { loadActiveConfig: vi.fn(async () => ({})) } }));
vi.mock("../template.service.js", () => ({ templateService: { renderTemplate: vi.fn() } }));
vi.mock("../notification-preferences.service.js", () => ({ notificationPreferencesService: { getDeliveryPreference: vi.fn() } }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { create: vi.fn() } }));

const { dispatchService } = await import("../dispatch.service.js");

/** A row as the log holds it. `bodyLen` is what decides whether the message survived intact. */
function stubRow(bodyLen: number, channel = "email") {
  mockExecute.mockReset();
  mockExecute.mockImplementation(async (sql: unknown) => {
    const s = String(sql ?? "");
    if (/SELECT channel, recipient_contact, body_preview/i.test(s)) {
      return [[{ channel, recipient_contact: "someone@teammas.in", body_preview: "x".repeat(bodyLen) }], []];
    }
    return [[], []];
  });
}

beforeEach(() => mockExecute.mockReset());

describe("retry refuses to deliver a message it only kept a preview of", () => {
  it("refuses when the stored body is at the 500-character limit", async () => {
    stubRow(500);
    await expect(dispatchService.retry("d-1")).rejects.toMatchObject({
      statusCode: 409,
      code: "DISPATCH_BODY_NOT_RETAINED",
    });
  });

  it("does not queue or increment retry_count when it refuses", async () => {
    // The old code marked the row 'queued' before delivering. A refusal that still moved the row
    // would leave a dispatch permanently queued and never sent.
    stubRow(500);
    await dispatchService.retry("d-1").catch(() => undefined);
    const wrote = mockExecute.mock.calls.some(([s]) => /UPDATE dispatch_log SET status = 'queued'/i.test(String(s)));
    expect(wrote).toBe(false);
  });

  it("tells the caller what to do instead of just failing", async () => {
    stubRow(500);
    await expect(dispatchService.retry("d-1")).rejects.toThrow(/Re-trigger the original event/i);
  });

  it("still retries a short body, so SMS and WhatsApp keep the feature", async () => {
    stubRow(120, "sms");
    await expect(dispatchService.retry("d-1")).resolves.toBeUndefined();
    const queued = mockExecute.mock.calls.some(([s]) => /UPDATE dispatch_log SET status = 'queued'/i.test(String(s)));
    expect(queued).toBe(true);
  });
});

describe("a missing dispatch answers 404, not a masked 500", () => {
  it("carries a statusCode, so the production error handler keeps the message", async () => {
    // A bare `throw new Error()` has its message replaced in production by the error handler, so
    // 'Dispatch not found' reached the admin as an opaque server error.
    mockExecute.mockReset();
    mockExecute.mockImplementation(async () => [[], []]);
    await expect(dispatchService.retry("nope")).rejects.toMatchObject({
      statusCode: 404,
      code: "DISPATCH_NOT_FOUND",
    });
  });
});
