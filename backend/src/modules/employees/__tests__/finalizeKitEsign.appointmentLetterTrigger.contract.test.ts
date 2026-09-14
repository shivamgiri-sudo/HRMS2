import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Once a candidate's joining kit is fully e-signed, the appointment letter
 * should auto-issue rather than wait for HR to trigger it by hand from
 * POST /appointment-letters/:employeeId/issue.
 *
 * finalizeKitEsign() is called only from the Luckpay webhook payload handler
 * (employeeJoiningDocuments.service.ts), downstream of signature verification
 * — nothing about the eSign transport layer changes here. The hook must sit
 * after the kit is actually marked 'signed' (the KIT_SIGNED audit line), and
 * must never let a letter-issuance failure propagate out of kit finalization:
 * issueAppointmentLetter() has its own eligibility gate (BGV, salary, branch
 * address, ...), so "not eligible yet" is an expected, non-fatal outcome.
 *
 * Why source-inspection rather than behavioural: this repo has no harness
 * that drives a real webhook payload through to a live database.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SERVICE = "src/modules/employees/joiningKitDispatch.service.ts";

function functionBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  if (start === -1) return "";
  const next = src.indexOf("\nexport async function ", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
}

describe("finalizeKitEsign auto-triggers the appointment letter", () => {
  const src = read(SERVICE);
  const body = functionBody(src, "finalizeKitEsign");

  it("finalizeKitEsign exists", () => {
    expect(body).toBeTruthy();
  });

  it("calls issueAppointmentLetter", () => {
    expect(body).toContain("issueAppointmentLetter");
  });

  it("issues the letter only after the kit is marked KIT_SIGNED", () => {
    const auditIdx = body.indexOf('"KIT_SIGNED"');
    const issueIdx = body.indexOf("issueAppointmentLetter");
    expect(auditIdx, "KIT_SIGNED audit call must exist").toBeGreaterThan(-1);
    expect(issueIdx, "issueAppointmentLetter call must exist").toBeGreaterThan(-1);
    expect(issueIdx).toBeGreaterThan(auditIdx);
  });

  it("swallows a rejection instead of letting it propagate out of kit finalization", () => {
    const issueIdx = body.indexOf("issueAppointmentLetter");
    const tail = body.slice(issueIdx);
    // Must be a detached promise chain with its own .catch(...), not a bare
    // `await issueAppointmentLetter(...)` with no surrounding handling — a
    // bare await would make a "not eligible yet" throw abort the whole
    // finalizeKitEsign call, and with it the kit's own completion.
    expect(tail).toMatch(/\.catch\(/);
    expect(tail.slice(0, tail.indexOf(".catch("))).not.toMatch(/^\s*await\s/);
  });

  it("treats already_issued as benign, not an error to log", () => {
    const issueIdx = body.indexOf("issueAppointmentLetter");
    const tail = body.slice(issueIdx, issueIdx + 800);
    expect(tail).toContain("already_issued");
  });
});
