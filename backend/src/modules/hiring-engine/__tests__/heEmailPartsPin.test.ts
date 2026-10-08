import { describe, expect, it, vi } from "vitest";

/** Pin of today's invite and follow-up email markup, taken before the answer buttons were extracted into he-email-parts.ts. */
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [[]]) } }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { isConfigured: () => true, send: vi.fn() } }));

import { buildInviteEmail } from "../he-email.service.js";
import { buildFollowUpEmail, type FollowKind } from "../he-followup-email.service.js";

const base = {
  name: "Asha", role: "Customer Success Executive", company: "MAS Callnet", branch: "NOIDA-2", address: "C-27, Sector 62, Noida",
  date: "Fri 9 Oct", time: "11:00 AM", maps: "https://maps.google.com/?q=28.6,77.3", docs: "Aadhaar, PAN, 12th marksheet",
  reference: "HE-ABC123", contact: "Riya 9999999999",
};
const URL = "https://x.test/w/0123456789abcdef0123456789abcdef";

describe("invite email markup pin", () => {
  it("with answer buttons and opt-in", () => {
    expect(buildInviteEmail({ ...base, answerUrl: URL, optInUrl: URL })).toMatchSnapshot();
  });
  it("without a token", () => {
    expect(buildInviteEmail({ ...base, answerUrl: null, optInUrl: null })).toMatchSnapshot();
  });
  for (const kind of ["confirmed", "reminder_1d", "reschedule_offer", "no_show"] as FollowKind[]) {
    it(`follow-up ${kind}`, () => {
      expect(buildFollowUpEmail({ ...base, kind, answerUrl: URL })).toMatchSnapshot();
    });
  }
});
