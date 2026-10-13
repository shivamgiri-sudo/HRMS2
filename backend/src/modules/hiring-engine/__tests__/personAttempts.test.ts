import { describe, expect, it } from "vitest";
import { attemptLabel, summariseAttempts, type AttemptEvent } from "../person-attempts.service.js";

const ev = (o: Partial<AttemptEvent> & Pick<AttemptEvent, "kind" | "at">): AttemptEvent => ({ requisitionId: "r1", requisitionCode: "NOIDA-Onfido-17", ...o });

describe("summariseAttempts", () => {
  it("a person nobody else reached is fresh", () => {
    const a = summariseAttempts("9000000001", [ev({ kind: "email", at: "2026-10-10 10:00:00", journeyId: "j-now" })], { journeyId: "j-now" });
    expect(a.type).toBe("fresh");
    expect(a.approachNo).toBe(1);
    expect(attemptLabel(a)).toBe("FRESH");
  });
  it("earlier contacts for other requisitions make a repeat, with counts per requisition", () => {
    const a = summariseAttempts("9000000001", [
      ev({ kind: "email", at: "2026-10-01 10:00:00", journeyId: "j1" }),
      ev({ kind: "whatsapp", at: "2026-10-01 11:00:00", journeyId: "j1" }),
      ev({ kind: "call", at: "2026-10-01 13:00:00", journeyId: "j1" }),
      ev({ kind: "call_connected", at: "2026-10-01 13:00:00", journeyId: "j1" }),
      ev({ requisitionId: "r2", requisitionCode: "NOIDA-Onfido-20", kind: "email", at: "2026-10-05 10:00:00", journeyId: "j2" }),
      ev({ requisitionId: "r3", requisitionCode: "NOIDA-Onfido-22", kind: "email", at: "2026-10-10 10:00:00", journeyId: "j-now" }),
    ], { journeyId: "j-now" });
    expect(a.type).toBe("repeat");
    expect(a.priorContacts).toBe(4);
    expect(a.timesConnected).toBe(1);
    expect(a.approachNo).toBe(3);
    expect(a.priorRequisitions.map((r) => [r.code, r.contacts, r.connected])).toEqual([["NOIDA-Onfido-20", 1, 0], ["NOIDA-Onfido-17", 3, 1]]);
    expect(attemptLabel(a)).toBe("REPEAT #3 | 4 contacts, 1 connected | NOIDA-Onfido-20 (1/0), NOIDA-Onfido-17 (3/1)");
  });
  it("a reply or a confirmation counts as connected, and an inbound alone is not a contact", () => {
    const a = summariseAttempts("9000000001", [
      ev({ kind: "email", at: "2026-10-01 10:00:00" }), ev({ kind: "inbound", at: "2026-10-01 12:00:00" }), ev({ kind: "confirmed", at: "2026-10-02 09:00:00" }),
    ], {});
    expect(a.priorContacts).toBe(1);
    expect(a.timesConnected).toBe(2);
  });
  it("only inbound or no events: still fresh", () => {
    expect(summariseAttempts("9", [], {}).type).toBe("fresh");
    expect(summariseAttempts("9", [ev({ kind: "inbound", at: "2026-10-01 12:00:00" })], {}).type).toBe("fresh");
  });
  it("the old Meta notification counts as an earlier approach", () => {
    expect(summariseAttempts("9", [ev({ kind: "legacy_notify", at: "2026-10-08 14:00:00" })], {}).type).toBe("repeat");
  });
});
