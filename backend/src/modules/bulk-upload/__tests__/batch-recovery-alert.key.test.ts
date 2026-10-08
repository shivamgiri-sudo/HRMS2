import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { isConfigured: () => false, send: vi.fn() } }));

import { inboxEntityKey } from "../batch-recovery-alert.js";

describe("inboxEntityKey", () => {
  it("fits work_inbox_item.entity_id (CHAR(36)) for the keys the recovery sweep really uses", () => {
    // `needs-human-<uuid>` is 48 chars: every alert insert failed with "Data too long for column 'entity_id'".
    const key = `needs-human-${"4f3c2b1a-0000-4000-8000-123456789abc"}`;
    expect(key.length).toBeGreaterThan(36);
    expect(inboxEntityKey(key).length).toBeLessThanOrEqual(36);
    expect(inboxEntityKey("kill-364399")).toBe("kill-364399");
  });

  it("is stable, so the dedupe lookup finds the row the insert wrote", () => {
    const key = `needs-human-${"4f3c2b1a-0000-4000-8000-123456789abc"}`;
    expect(inboxEntityKey(key)).toBe(inboxEntityKey(key));
    expect(inboxEntityKey(key)).not.toBe(inboxEntityKey(`${key}x`));
  });
});
