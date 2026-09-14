/**
 * Mail ABOUT someone else must not land in a personal mailbox.
 *
 * `employees.email` holds a personal address for 354 of the 1,125 active
 * employees (measured against live mas_hrms, 2026-08-08), and dispatch.service
 * sent every channel to that column. Some catalogue events describe a THIRD
 * PARTY — an eSign escalation naming an employee and their code, an
 * engagement/attrition risk assessment, an internal job application — so those
 * were being delivered to Gmail.
 *
 * It surfaced concretely: a preboarding candidate received 29 "eSign link
 * expiring — employee non-responsive" mails naming a *different* employee's
 * unsigned BAMS Declaration, because the branch-HR lookup returned a colleague
 * whose `email` column is personal.
 *
 * The safety property that makes this deployable is that it can only ever
 * REDIRECT, never drop: 354 recipients move to a company address and 0 lose
 * delivery. These tests pin that.
 */
import { describe, expect, it } from "vitest";
import { resolveEmailContact } from "../dispatch.service.js";
import { NOTIFICATION_EVENT_CATALOG } from "../notification-event.service.js";

const PERSONAL = "sofiyasultan57@gmail.com";
const OFFICIAL = "sofiya.sultan@teammas.co.in";

describe("resolveEmailContact", () => {
  it("prefers a company official_email for third-party content", () => {
    expect(resolveEmailContact({ email: PERSONAL, official_email: OFFICIAL }, true)).toBe(OFFICIAL);
  });

  it("leaves ordinary notifications on the normal address", () => {
    // Notifications about YOURSELF keep going where they always went. This is
    // deliberately not a blanket redirect.
    expect(resolveEmailContact({ email: PERSONAL, official_email: OFFICIAL }, false)).toBe(PERSONAL);
    expect(resolveEmailContact({ email: PERSONAL, official_email: OFFICIAL })).toBe(PERSONAL);
  });

  describe("never silences anyone — the property that makes this safe", () => {
    it("falls back when official_email is missing or blank", () => {
      expect(resolveEmailContact({ email: PERSONAL, official_email: null }, true)).toBe(PERSONAL);
      expect(resolveEmailContact({ email: PERSONAL, official_email: "   " }, true)).toBe(PERSONAL);
    });

    it("falls back when official_email is NOT a company domain", () => {
      // 519 employees have a gmail address sitting in the official_email column.
      // Preferring that would be a redirect to nowhere useful.
      expect(resolveEmailContact({ email: PERSONAL, official_email: "someone@gmail.com" }, true))
        .toBe(PERSONAL);
    });

    it("does not invent an address when there is none", () => {
      expect(resolveEmailContact({ email: null, official_email: null }, true)).toBeNull();
    });

    it("accepts company subdomains but not lookalike domains", () => {
      expect(resolveEmailContact({ email: PERSONAL, official_email: "a@hr.teammas.in" }, true))
        .toBe("a@hr.teammas.in");
      // `noteammas.in` must NOT pass — a bare endsWith would have accepted it.
      expect(resolveEmailContact({ email: PERSONAL, official_email: "a@noteammas.in" }, true))
        .toBe(PERSONAL);
    });
  });
});

describe("catalogue: which events are about a third party", () => {
  const flagged = Object.entries(NOTIFICATION_EVENT_CATALOG)
    .filter(([, d]) => "aboutThirdParty" in d && (d as { aboutThirdParty?: boolean }).aboutThirdParty)
    .map(([code]) => code)
    .sort();

  it("flags exactly the events whose text names someone other than the recipient", () => {
    expect(flagged).toEqual([
      "esign_escalation_hr",
      "esign_escalation_manager",
      "ijp_manager_approval_pending",
      "people_experience_action_assigned",
      "people_experience_action_overdue",
      "people_experience_risk_detected",
    ]);
  });

  it("every flagged event really does interpolate a third party", () => {
    for (const code of flagged) {
      const d = NOTIFICATION_EVENT_CATALOG[code as keyof typeof NOTIFICATION_EVENT_CATALOG];
      const text = `${d.title} ${d.message} ${d.shortMessage}`;
      expect(text, `${code} is flagged but names nobody`).toMatch(/\{\{employee_name\}\}|\{\{employee_code\}\}/);
    }
  });

  it("does not flag events addressed to the person themselves", () => {
    // payslip_ready and leave_decision are about YOU; redirecting them would be
    // a behaviour change nobody asked for.
    for (const code of ["payslip_ready", "leave_decision", "esign_reminder", "attendance_late"]) {
      const d = NOTIFICATION_EVENT_CATALOG[code as keyof typeof NOTIFICATION_EVENT_CATALOG] as {
        aboutThirdParty?: boolean;
      };
      expect(Boolean(d.aboutThirdParty), `${code} should not be flagged`).toBe(false);
    }
  });
});
