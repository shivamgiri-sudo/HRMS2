import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Round-trip contracts for the assessment admin pages. The database is remote, so each sequential
 * `await db.execute` costs a full network round trip; these reads are independent and are now
 * issued together:
 *
 *  - getAssessmentDashboard: overall metrics and the per-process breakdown.
 *  - getAssessmentAttemptDetail: template, responses, typing attempts and audit trail.
 *  - countQuestionBankStats: four aggregates.
 *
 * Responses are unchanged, so each test pins the assembled output as well.
 */

process.env.ATS_ASSESSMENT_ENABLED = "true";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));

const svc = await import("../assessment.service.js");
const qb = await import("../question-bank.service.js");

/** Only the statements matching `watch` count towards concurrency; everything else answers at once. */
function track(watch: (sql: string) => boolean, handler: (sql: string) => unknown) {
  let inFlight = 0;
  let max = 0;
  execute.mockImplementation(async (sql: string) => {
    const s = String(sql);
    const watched = watch(s);
    if (watched) {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
    }
    const out = handler(s);
    if (out instanceof Error) throw out;
    return [out ?? [], []];
  });
  return { max: () => max };
}

beforeEach(() => {
  execute.mockReset();
});

describe("getAssessmentDashboard", () => {
  it("issues the metrics and the per-process breakdown together", async () => {
    const t = track(
      (s) => s.includes("FROM ats_candidate_assessment"),
      (s) => {
        if (s.includes("total_assigned")) return [{ total_assigned: 10, passed: 6 }];
        if (s.includes("GROUP BY t.process_key, t.role_key")) return [{ process_key: "inbound", role_key: "executive", total: 10 }];
        return [];
      },
    );
    const out = await svc.getAssessmentDashboard();
    expect(t.max()).toBe(2);
    expect(out).toEqual({
      metrics: { total_assigned: 10, passed: 6 },
      byProcess: [{ process_key: "inbound", role_key: "executive", total: 10 }],
    });
  });

  it("returns empty metrics when the table is empty, as before", async () => {
    track((s) => s.includes("FROM ats_candidate_assessment"), () => []);
    expect(await svc.getAssessmentDashboard()).toEqual({ metrics: {}, byProcess: [] });
  });
});

describe("getAssessmentAttemptDetail", () => {
  it("reads template, responses, typing and audit together and assembles the same detail", async () => {
    const t = track(
      (s) => /FROM ats_assessment_template WHERE id|FROM ats_assessment_response|FROM ats_typing_test_attempt|FROM ats_assessment_audit_log/.test(s),
      (s) => {
        if (s.includes("WHERE a.id = ?")) {
          return [{ id: "a1", template_id: "t1", config_snapshot: JSON.stringify({ code: "T1", sections: [] }), section_scores: "{}", client_meta: "{}" }];
        }
        if (s.includes("FROM ats_assessment_template WHERE id")) return [{ id: "t1", template_code: "T1" }];
        if (s.includes("FROM ats_assessment_response")) return [{ id: "r1", question_snapshot: "{}", answer_text: "x" }];
        if (s.includes("FROM ats_typing_test_attempt")) return [];
        if (s.includes("FROM ats_assessment_audit_log")) return [{ event_type: "started", event_payload: "{\"k\":1}" }];
        return [];
      },
    );
    const out = await svc.getAssessmentAttemptDetail("a1");
    expect(t.max()).toBe(4);
    expect(out.attempt).toMatchObject({ id: "a1", section_scores: {}, client_meta: {} });
    expect(out.template).toEqual({ code: "T1", sections: [] });
    expect(out.responses).toHaveLength(1);
    expect(out.typingAttempts).toEqual([]);
    expect(out.audit).toEqual([{ event_type: "started", event_payload: { k: 1 } }]);
  });

  it("still 404s for an unknown attempt without reading anything else", async () => {
    const t = track(() => false, () => []);
    await expect(svc.getAssessmentAttemptDetail("missing")).rejects.toMatchObject({ statusCode: 404 });
    expect(t.max()).toBe(0);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes("FROM ats_assessment_response"))).toBe(false);
  });
});

describe("question bank stats", () => {
  it("issues its four aggregates together and combines them as before", async () => {
    const t = track(
      (s) => /FROM ats_question_bank|FROM ats_typing_passage_bank/.test(s),
      (s) => {
        if (s.includes("SELECT COUNT(*) as count FROM ats_question_bank")) return [{ count: 120 }];
        if (s.includes("SELECT COUNT(*) as count FROM ats_typing_passage_bank")) return [{ count: 30 }];
        if (s.includes("question_count")) return [{ process_key: "inbound", role_key: "executive", question_count: 100, set_count: 4 }];
        if (s.includes("passage_count")) return [{ process_key: "inbound", role_key: "executive", passage_count: 9 }];
        return [];
      },
    );
    const out = await qb.countQuestionBankStats();
    expect(t.max()).toBe(4);
    expect(out).toEqual({
      totalQuestions: 120,
      totalPassages: 30,
      byProcessRole: [{ process: "inbound", role: "executive", questionCount: 100, passageCount: 9, setCount: 4 }],
    });
  });
});
