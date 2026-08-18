import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * dispatch.service.ts._deliver() used to send every SMS with the rendered, human-readable
 * subject line in the slot SmartPing (the live provider) requires a numeric TRAI DLT template
 * id for — every SMS through this pipeline was rejected. Fixed by resolving event_code (+ the
 * same data the event's own templates render against) through event-sms-template-map.ts, and
 * skipping SMS outright (status='skipped', provider.send never called) for any event with no
 * mapped DLT template, rather than attempting-and-failing.
 *
 * Uses the REAL event-sms-template-map.ts/smartping-dlt-registry.ts (not mocked) so this
 * actually proves the registered DLT ids and variable mapping are correct, not just that some
 * function got called.
 */

const { mockExecute } = vi.hoisted(() => ({ mockExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: mockExecute } }));
vi.mock("../../../shared/notification-dispatch-block.js", () => ({
  getDispatchBlock: vi.fn(async () => ({ blocked: false })),
}));

const { mockGetProviderAsync, fakeSend } = vi.hoisted(() => ({
  mockGetProviderAsync: vi.fn(),
  fakeSend: vi.fn(async () => ({ success: true })),
}));
vi.mock("../providers/provider.factory.js", () => ({
  providerFactory: { getProviderAsync: mockGetProviderAsync },
}));
vi.mock("../provider-config.service.js", () => ({
  providerConfigService: { loadActiveConfig: vi.fn(async () => null) },
}));
vi.mock("../template.service.js", () => ({
  templateService: {
    renderTemplate: vi.fn(async () => ({
      subject: "A human-readable subject line — never valid as an SMS DLT id",
      html: "<p>body</p>",
      text: "body",
    })),
  },
}));
vi.mock("../notification-preferences.service.js", () => ({
  notificationPreferencesService: {
    getDeliveryPreference: vi.fn(async () => ({ enabled: true, channel: "email" })),
  },
}));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem: vi.fn() } }));

const { dispatchService } = await import("../dispatch.service.js");

/** Fake provider whose send() is a spy — no network, no real SmartPing call. */
function fakeProvider() {
  return {
    validateRecipient: () => true,
    send: fakeSend,
  };
}

function stubEmployeeAndInsert() {
  mockExecute.mockReset();
  mockExecute.mockImplementation(async (sql: unknown) => {
    const s = String(sql ?? "");
    if (/SELECT id, user_id, full_name, email, official_email, mobile AS phone FROM employees/i.test(s)) {
      return [[{ id: "emp-1", user_id: null, full_name: "Priya Sharma", email: "priya@teammas.in", official_email: null, phone: "9876543210" }], []];
    }
    // Non-SMS channels re-read the rendered subject back from the row _deliver just inserted —
    // matches the real subject renderTemplate's mock resolves above.
    if (/SELECT subject FROM dispatch_log WHERE id/i.test(s)) {
      return [[{ subject: "A human-readable subject line — never valid as an SMS DLT id" }], []];
    }
    // INSERT into dispatch_log, and every UPDATE dispatch_log call — just acknowledge.
    return [{ affectedRows: 1 }, []];
  });
}

beforeEach(() => {
  mockGetProviderAsync.mockReset();
  mockGetProviderAsync.mockResolvedValue(fakeProvider());
  fakeSend.mockClear();
  fakeSend.mockResolvedValue({ success: true });
  stubEmployeeAndInsert();
});

async function flush() {
  // _deliver() is fire-and-forget from send() (.catch(), not awaited) — let its promise chain
  // (several awaits deep: loadActiveConfig -> getProviderAsync -> validateRecipient -> send ->
  // the final UPDATE) actually run before asserting on it.
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe("dispatch.service.ts SMS delivery — DLT template resolution", () => {
  it("a mapped event resolves to the real registered DLT id and renders the real template text, not the human subject", async () => {
    await dispatchService.send({
      recipient_employee_ids: ["emp-1"],
      data: { from_date: "2026-08-20", to_date: "2026-08-22" },
      channels: ["sms"],
      portal: false,
      event_code: "leave_submitted",
    });
    await flush();

    expect(fakeSend).toHaveBeenCalledTimes(1);
    const [contact, subjectSlot, body] = fakeSend.mock.calls[0];
    expect(contact).toBe("9876543210");
    // 1707178367692812584 is leave_request_submitted's real registered dltContentId
    // (smartping-dlt-registry.ts) — not the rendered "A human-readable subject line...".
    expect(subjectSlot).toBe("1707178367692812584");
    expect(body).toContain("Priya Sharma");
    expect(body).toContain("2026-08-20");
    expect(body).toContain("2026-08-22");
  });

  it("an event with no registered DLT template is skipped, not attempted", async () => {
    await dispatchService.send({
      recipient_employee_ids: ["emp-1"],
      data: {},
      channels: ["sms"],
      portal: false,
      event_code: "birthday_greeting", // real catalogue event, confirmed to have no registry match
    });
    await flush();

    expect(fakeSend).not.toHaveBeenCalled();
    const skipUpdate = mockExecute.mock.calls.find(([s]) => /UPDATE dispatch_log SET status = 'skipped'/i.test(String(s)));
    expect(skipUpdate).toBeTruthy();
    expect(String(skipUpdate?.[1]?.[0])).toMatch(/no registered dlt template/i);
  });

  it("a mapped event missing its required variables is skipped, not sent with blanks", async () => {
    await dispatchService.send({
      recipient_employee_ids: ["emp-1"],
      data: {}, // leave_submitted needs from_date/to_date — neither supplied
      channels: ["sms"],
      portal: false,
      event_code: "leave_submitted",
    });
    await flush();

    expect(fakeSend).not.toHaveBeenCalled();
    const skipUpdate = mockExecute.mock.calls.find(([s]) => /UPDATE dispatch_log SET status = 'skipped'/i.test(String(s)));
    expect(skipUpdate).toBeTruthy();
  });

  it("no event_code at all is skipped with a distinct reason, not attempted", async () => {
    await dispatchService.send({
      recipient_employee_ids: ["emp-1"],
      data: {},
      channels: ["sms"],
      portal: false,
    });
    await flush();

    expect(fakeSend).not.toHaveBeenCalled();
    const skipUpdate = mockExecute.mock.calls.find(([s]) => /UPDATE dispatch_log SET status = 'skipped'/i.test(String(s)));
    expect(skipUpdate).toBeTruthy();
    expect(String(skipUpdate?.[1]?.[0])).toMatch(/no event_code/i);
  });

  it("writes event_code onto the dispatch_log row for audit", async () => {
    await dispatchService.send({
      recipient_employee_ids: ["emp-1"],
      data: { from_date: "2026-08-20", to_date: "2026-08-22" },
      channels: ["sms"],
      portal: false,
      event_code: "leave_submitted",
    });
    await flush();

    const insert = mockExecute.mock.calls.find(([s]) => /INSERT INTO dispatch_log/i.test(String(s)));
    expect(insert).toBeTruthy();
    const [sql, params] = insert as [string, unknown[]];
    const eventCodeIdx = /event_code/i.test(sql) ? sql
      .slice(sql.indexOf("("), sql.indexOf(")"))
      .split(",")
      .findIndex(col => /event_code/i.test(col)) : -1;
    expect(eventCodeIdx).toBeGreaterThanOrEqual(0);
    expect(params[eventCodeIdx]).toBe("leave_submitted");
  });

  it("does not change email delivery — still sends the rendered subject, not a DLT id", async () => {
    await dispatchService.send({
      recipient_employee_ids: ["emp-1"],
      data: {},
      channels: ["email"],
      portal: false,
      event_code: "birthday_greeting",
    });
    await flush();

    expect(fakeSend).toHaveBeenCalledTimes(1);
    const [, subjectSlot] = fakeSend.mock.calls[0];
    expect(subjectSlot).toBe("A human-readable subject line — never valid as an SMS DLT id");
  });
});
