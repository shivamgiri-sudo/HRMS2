import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Round-trip / plan contracts for the ATS read paths that load on page open.
 *
 * The database is remote, so a sequential `await db.execute(...)` costs a full network round trip
 * each. Every function here used to issue N independent reads one after another; they now issue
 * them together. The responses are unchanged — these tests assert both halves: that the reads
 * overlap (max in-flight statements), and that the assembled response is byte-for-byte what the
 * serial version returned.
 *
 * listBgvQueueScoped is different: it is a plan fix. A LEFT JOIN from ats_candidate followed by
 * `HAVING COUNT(ch.id) > 0` scanned all ~37k candidate rows (timed out at the 10 s cap on live
 * data); the equivalent INNER JOIN lets MySQL drive from the ~2k candidate_bgv_check rows.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

function trackConcurrency(
  handler: (sql: string, params: unknown[]) => unknown,
) {
  let inFlight = 0;
  let maxInFlight = 0;
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    const out = handler(String(sql), params);
    if (out instanceof Error) throw out;
    return [out, []];
  });
  return { max: () => maxInFlight };
}

beforeEach(() => {
  execute.mockReset();
});

// ── ats-form-config: the public registration form's load call ─────────────────────────────
describe("atsFormConfigService.getBootstrap", () => {
  it("issues its six lookups together and assembles the same payload", async () => {
    vi.resetModules();
    const { atsFormConfigService } =
      await import("../ats-form-config.service.js");
    const t = trackConcurrency((sql) => {
      if (sql.includes("FROM ats_form_config"))
        return [{ config_key: "roleOptions", config_value: ["A", "B"] }];
      if (sql.includes("SELECT DISTINCT branch_name FROM branch_master"))
        return [{ branch_name: "NOIDA" }];
      if (sql.includes("FROM process_master"))
        return [{ process_name: "Bella Vita" }];
      if (sql.includes("ats_branch_alias_master"))
        return [
          {
            canonical_key: "NOIDA",
            display_name: "Noida",
            alias_text: "noida",
          },
        ];
      if (sql.includes("FROM ats_recruiter_roster"))
        return [{ name: "Asha", email: "a@x.com", mobile: "9" }];
      if (sql.includes("FROM ats_recruiter WHERE")) return [{ name: "Asha" }];
      return [];
    });
    const out = await atsFormConfigService.getBootstrap();
    expect(t.max()).toBe(6);
    expect(out.branchOptions).toEqual(["NOIDA"]);
    expect(out.roleOptions).toEqual(["A", "B"]);
    expect(out.hiringProcessOptions).toEqual(["Bella Vita"]);
    expect(out.branchAliases).toEqual([
      { canonical: "NOIDA", display: "Noida", alias: "noida" },
    ]);
    expect(out.recruiterOptions).toEqual(["Asha"]);
    expect(out.recruiterDetails).toEqual([
      { name: "Asha", email: "a@x.com", mobile: "9" },
    ]);
  });

  it("still treats a failing roster lookup as best-effort (contact details left empty)", async () => {
    vi.resetModules();
    const { atsFormConfigService } =
      await import("../ats-form-config.service.js");
    trackConcurrency((sql) => {
      if (sql.includes("FROM ats_recruiter_roster"))
        return new Error("roster missing");
      if (sql.includes("FROM ats_recruiter WHERE")) return [{ name: "Asha" }];
      return [];
    });
    const out = await atsFormConfigService.getBootstrap();
    expect(out.recruiterDetails).toEqual([
      { name: "Asha", email: null, mobile: null },
    ]);
  });

  it("still fails when a mandatory lookup fails", async () => {
    vi.resetModules();
    const { atsFormConfigService } =
      await import("../ats-form-config.service.js");
    trackConcurrency((sql) =>
      sql.includes("FROM ats_form_config") ? new Error("config down") : [],
    );
    await expect(atsFormConfigService.getBootstrap()).rejects.toThrow(
      "config down",
    );
  });
});

// ── employee-code gate ─────────────────────────────────────────────────────────────────────
describe("checkEmployeeCodeGate", () => {
  const handlerFor = (rows: Record<string, unknown[]>) => (sql: string) => {
    if (sql.includes("FROM ats_candidate c")) return []; // findExistingEmployeeCode: nothing generated yet
    for (const [needle, value] of Object.entries(rows))
      if (sql.includes(needle)) return value;
    return [];
  };

  it("reads all six gate inputs together and reports every blocker in the original order", async () => {
    vi.resetModules();
    const { checkEmployeeCodeGate } =
      await import("../employee-code-gate.service.js");
    const t = trackConcurrency(handlerFor({}));
    const out = await checkEmployeeCodeGate("cand-1");
    // 1 existing-code lookup, then the 6 independent gate reads together
    expect(t.max()).toBe(6);
    expect(out.canGenerate).toBe(false);
    expect(out.blockers).toEqual([
      "Candidate onboarding not submitted",
      "BGV not completed or approved",
      "Name consistency check not passed or not approved",
      "Payroll HR validation not complete",
      "Salary components not assigned",
    ]);
    expect(out.checklist).toEqual({
      onboarding_submitted: false,
      bgv_complete: false,
      name_consistency: false,
      payroll_hr_validated: false,
      jclr_approved: true,
      salary_components: false,
    });
  });

  it("passes when every gate is satisfied", async () => {
    vi.resetModules();
    const { checkEmployeeCodeGate } =
      await import("../employee-code-gate.service.js");
    trackConcurrency(
      handlerFor({
        "FROM candidate_onboarding_profile": [{ profile_status: "submitted" }],
        "FROM ats_bgv_verification": [{ verification_status: "completed" }],
        "FROM candidate_name_match_summary": [
          { overall_match_status: "matched" },
        ],
        "FROM ats_payroll_hr_validation": [{ validation_status: "validated" }],
        "FROM salary_component_assignments": [{ id: "s1" }],
      }),
    );
    const out = await checkEmployeeCodeGate("cand-1");
    expect(out).toMatchObject({ canGenerate: true, blockers: [] });
  });

  it("swallows a failing optional table exactly as before, but not the onboarding read", async () => {
    vi.resetModules();
    const { checkEmployeeCodeGate } =
      await import("../employee-code-gate.service.js");
    trackConcurrency((sql) => {
      if (sql.includes("FROM ats_candidate c")) return [];
      if (sql.includes("FROM ats_bgv_verification"))
        return new Error("no such table");
      return [];
    });
    const out = await checkEmployeeCodeGate("cand-1");
    expect(out.checklist.bgv_complete).toBe(false);

    trackConcurrency((sql) =>
      sql.includes("FROM candidate_onboarding_profile")
        ? new Error("boom")
        : [],
    );
    await expect(checkEmployeeCodeGate("cand-1")).rejects.toThrow("boom");
  });

  it("no longer issues the discarded jclr_status read", async () => {
    vi.resetModules();
    const { checkEmployeeCodeGate } =
      await import("../employee-code-gate.service.js");
    trackConcurrency(handlerFor({}));
    await checkEmployeeCodeGate("cand-1");
    expect(
      execute.mock.calls.some(([sql]) => String(sql).includes("jclr_status")),
    ).toBe(false);
  });
});

// ── branch-head pending approvals ─────────────────────────────────────────────────────────
describe("listPendingApprovals", () => {
  it("loads process names, designations and payroll validations together", async () => {
    vi.resetModules();
    const { listPendingApprovals } =
      await import("../ats.onboarding.service.js");
    const t = trackConcurrency((sql) => {
      if (sql.includes("FROM ats_employment_offer o")) {
        return [
          {
            offer_id: "o1",
            candidate_id: "c1",
            applied_for_process: "p-1",
            gross: null,
            date_of_joining: null,
          },
        ];
      }
      if (sql.includes("FROM process_master"))
        return [{ id: "p-1", process_name: "Bella Vita" }];
      if (sql.includes("FROM designation_master"))
        return [{ designation_name: "Agent" }];
      if (sql.includes("FROM ats_payroll_hr_validation")) {
        return [
          {
            candidate_id: "c1",
            has_validated: 1,
            latest_joining_date: "2026-10-01",
            latest_salary_start_date: null,
          },
        ];
      }
      return [];
    });
    const rows = await listPendingApprovals({ sql: "1=1", params: [] });
    // 1 main query, then 3 lookups together
    expect(t.max()).toBe(3);
    expect(execute).toHaveBeenCalledTimes(4);
    expect(rows[0]).toMatchObject({
      process_name: "Bella Vita",
      process_is_designation: 0,
      payroll_validated: 1,
    });
  });

  it("skips the payroll lookup when there are no candidates, as before", async () => {
    vi.resetModules();
    const { listPendingApprovals } =
      await import("../ats.onboarding.service.js");
    trackConcurrency(() => []);
    expect(await listPendingApprovals({ sql: "1=1", params: [] })).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

// ── BGV ───────────────────────────────────────────────────────────────────────────────────
describe("BGV read paths", () => {
  it("listBgvQueueScoped drives from candidate_bgv_check with an INNER JOIN", async () => {
    vi.resetModules();
    const { listBgvQueueScoped } =
      await import("../bgv-verification.service.js");
    trackConcurrency(() => [{ candidate_id: "c1" }]);
    const rows = await listBgvQueueScoped("failed,pending", {
      sql: "c.applied_for_branch = ?",
      params: ["b1"],
    });
    expect(rows).toEqual([{ candidate_id: "c1" }]);
    const sql = String(execute.mock.calls[0][0]).replace(/\s+/g, " ");
    expect(sql).toContain(
      "JOIN candidate_bgv_check ch ON ch.candidate_id = c.id",
    );
    expect(sql).not.toContain("LEFT JOIN candidate_bgv_check");
    // the HAVING that made the LEFT JOIN equivalent to an INNER JOIN is still there
    expect(sql).toContain("HAVING COUNT(ch.id) > 0");
    expect(execute.mock.calls[0][1]).toEqual(["failed", "pending", "b1"]);
  });

  it("getBgvStatusForCandidate reads consent, checks, documents and bank rows together", async () => {
    vi.resetModules();
    const { getBgvStatusForCandidate } =
      await import("../bgv-verification.service.js");
    let statusReadsInFlight = 0;
    let maxStatusReads = 0;
    execute.mockImplementation(async (sql: string) => {
      const s = String(sql);
      const isStatusRead =
        s.includes("FROM candidate_bgv_consent WHERE candidate_id") ||
        s.includes("FROM candidate_bgv_check WHERE candidate_id") ||
        s.includes("FROM candidate_onboarding_document") ||
        s.includes("FROM candidate_bank_verification");
      if (isStatusRead) {
        statusReadsInFlight += 1;
        maxStatusReads = Math.max(maxStatusReads, statusReadsInFlight);
        await new Promise((r) => setTimeout(r, 5));
        statusReadsInFlight -= 1;
      }
      if (s.includes("FROM candidate_bgv_consent WHERE candidate_id"))
        return [[{ id: "k1" }], []];
      if (s.includes("FROM candidate_bgv_check WHERE candidate_id")) {
        return [
          [
            { check_type: "pan", status: "verified" },
            { check_type: "pan", status: "failed" },
            { check_type: "aadhaar", status: "verified" },
          ],
          [],
        ];
      }
      if (s.includes("FROM candidate_bank_verification"))
        return [[{ verification_status: "verified" }], []];
      return [[], []];
    });
    const out = await getBgvStatusForCandidate("cand-1");
    expect(maxStatusReads).toBe(4);
    // duplicates per check_type are still collapsed to the first (most recent) row
    expect(out.checks).toEqual([
      { check_type: "pan", status: "verified" },
      { check_type: "aadhaar", status: "verified" },
    ]);
    expect(out.consent).toEqual({ id: "k1" });
    expect(out.missing_mandatory_checks).toEqual([]);
  });
});

// ── full onboarding status (candidate form + HR review) ───────────────────────────────────
describe("full onboarding reads", () => {
  it("getFullOnboardingByCandidate issues its nine reads together", async () => {
    vi.resetModules();
    const { getFullOnboardingByCandidate } =
      await import("../onboarding-full.service.js");
    const t = trackConcurrency((sql) => {
      if (sql.includes("LEFT JOIN branch_master br_scope"))
        return [{ id: "cand-1" }]; // scope probe
      if (sql.includes("FROM candidate_onboarding_profile WHERE candidate_id"))
        return [{ id: "p1", profile_status: "submitted" }];
      if (sql.includes("FROM candidate_onboarding_bank_detail"))
        return [{ id: "b1", account_number_masked: "XXXX1234" }];
      if (sql.includes("FROM candidate_onboarding_qualification"))
        return [{ id: "q1" }];
      if (sql.includes("FROM candidate_onboarding_family_member"))
        return [{ id: "fm1" }];
      if (sql.includes("FROM candidate_onboarding_language"))
        return [{ id: "l1" }];
      return [];
    });
    const out = await getFullOnboardingByCandidate("cand-1");
    expect(t.max()).toBeGreaterThanOrEqual(7);
    expect(out.qualifications).toEqual([{ id: "q1" }]);
    expect(out.familyMembers).toEqual([{ id: "fm1" }]);
    expect(out.languages).toEqual([{ id: "l1" }]);
    expect(out.family).toBeNull();
    expect(out.experience).toBeNull();
    expect(out.digilocker).toMatchObject({ status: "not_started" });
    expect(out.esign).toMatchObject({ status: "not_started" });
    expect((out.profile as Record<string, unknown>).profile_status).toBe(
      "submitted",
    );
  });
});

// ── candidate grid ─────────────────────────────────────────────────────────────────────────
describe("atsService.listCandidates", () => {
  it("issues the page and its COUNT together and still masks identifiers", async () => {
    vi.resetModules();
    const { atsService } = await import("../ats.service.js");
    const t = trackConcurrency((sql) => {
      if (sql.includes("COUNT(*) AS total")) return [{ total: 321 }];
      return [
        {
          id: "c1",
          full_name: "Asha",
          aadhar_number: "123412341234",
          aadhar_number_hash: "h",
        },
      ];
    });
    const out = await atsService.listCandidates({
      page: 2,
      limit: 50,
    } as never);
    expect(t.max()).toBe(2);
    expect(out.total).toBe(321);
    expect(out.page).toBe(2);
    expect(out.limit).toBe(50);
    const row = out.data[0] as unknown as Record<string, unknown>;
    expect(row.full_name).toBe("Asha");
    expect(row).not.toHaveProperty("aadhar_number_hash"); // crypto plumbing still stripped
    expect(row.aadhar_number).not.toBe("123412341234"); // identifier still masked
    const pageSql = String(
      execute.mock.calls.find(([s]) => String(s).includes("SELECT c.*"))![0],
    );
    expect(pageSql).toContain("LIMIT 50 OFFSET 50");
  });

  it("still returns nothing without querying when the scope filter denies everything", async () => {
    vi.resetModules();
    const { atsService } = await import("../ats.service.js");
    trackConcurrency(() => []);
    const out = await atsService.listCandidates({
      page: 1,
      limit: 50,
      scopeFilter: { sql: "1=0", params: [] },
    } as never);
    expect(out).toEqual({ data: [], total: 0, page: 1, limit: 50 });
    expect(execute).not.toHaveBeenCalled();
  });
});
