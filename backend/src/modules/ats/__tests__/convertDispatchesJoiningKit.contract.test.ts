/**
 * "Generate employee code" in the Joining Control Room must send the kit.
 *
 * createEmployeeFromCandidate auto-dispatches the kit, but convertCandidateToEmployee
 * creates nobody — it returns an employee the orchestrator already made. So every
 * joiner created before auto-dispatch existed, and every one whose kit blocked at
 * creation time on a reason since resolved, got a code back from this path and no
 * kit. Production showed the shape of it: four kits ever, none of them automatic.
 *
 * The second contract matters more than the first. The orchestrator regenerates
 * the document drafts before dispatching, which is right for a brand-new employee
 * and wrong here: attachGeneratedArtifact resets checklist status to
 * 'draft_generated' for everything it regenerates, so doing that to an existing
 * employee would downgrade documents that are already esign_completed. This path
 * must dispatch from the drafts that exist and block honestly when some are
 * missing.
 *
 * Source contracts rather than a live call: dispatching for real bills the eSign
 * provider, and the guard being asserted is the absence of a call.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const CONVERT = fs.readFileSync(
  path.resolve(__dirname, "..", "ats.convert.service.ts"), "utf8");

describe("convertCandidateToEmployee dispatches the joining kit", () => {
  it("queues and dispatches a kit", () => {
    expect(CONVERT).toMatch(/import \{[^}]*queueJoiningKit[^}]*dispatchJoiningKit[^}]*\}/);
    expect(CONVERT).toMatch(/queueJoiningKit\(\{/);
    expect(CONVERT).toMatch(/dispatchJoiningKit\(kitId/);
  });

  it("labels the trigger so the source of a kit stays auditable", () => {
    expect(CONVERT).toMatch(/triggerSource: 'joining_control_room'/);
  });

  it("never regenerates drafts, which would downgrade signed documents", () => {
    // attachGeneratedArtifact writes status='draft_generated' unconditionally.
    // Matching a CALL, not the identifier: the comment in the source names both
    // functions to explain why they are absent, and that must stay allowed.
    expect(CONVERT).not.toMatch(/autoGenerateJoiningDocuments\s*\(/);
    expect(CONVERT).not.toMatch(/generateChecklistDraft\s*\(/);
    expect(CONVERT).not.toMatch(/^\s*import[^;]*autoGenerateJoiningDocuments/m);
  });

  it("does not block the caller or fail the conversion on a kit error", () => {
    // HR asked for an employee code. A provider outage must not turn that into
    // a failed request, and must not leave the response waiting on an eSign call.
    const at = CONVERT.indexOf("queueJoiningKit({");
    expect(at).toBeGreaterThan(-1);
    const preceding = CONVERT.slice(Math.max(0, at - 200), at);
    expect(preceding, "the dispatch must be fire-and-forget").toMatch(/void\s+$|void\s*queueJoiningKit/);
    const block = CONVERT.slice(at, at + 1600);
    expect(block).toContain(".catch(");
  });

  it("returns the employee code regardless of what the kit did", () => {
    const kitAt = CONVERT.indexOf("queueJoiningKit({");
    const returnAt = CONVERT.indexOf("employee_code: String(bridge.employee_code)");
    expect(returnAt).toBeGreaterThan(kitAt);
  });
});
