import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDefaultTemplate } from "../assessment.catalog.js";
import { assessmentService } from "../assessment.service.js";
import { db } from "../../../db/mysql.js";

const runIntegration = process.env.RUN_ASSESSMENT_MYSQL_TESTS === "1";
const integrationDescribe = runIntegration ? describe : describe.skip;

integrationDescribe("ATS assessment MySQL lifecycle", () => {
  const candidateId = randomUUID();
  const queueTokenId = randomUUID();
  const queueToken = `TEST-${Date.now()}`;
  const mobile = "9876543210";

  beforeAll(async () => {
    await db.execute("DELETE FROM ats_assessment_audit_log");
    await db.execute("DELETE FROM ats_typing_test_attempt");
    await db.execute("DELETE FROM ats_assessment_response");
    await db.execute("DELETE FROM ats_candidate_assessment");
    await db.execute("DELETE FROM ats_assessment_mapping");
    await db.execute("DELETE FROM ats_assessment_template");
    await db.execute("DELETE FROM ats_queue_token");
    await db.execute("DELETE FROM ats_candidate");

    await db.execute(
      `INSERT INTO ats_candidate (
        id, candidate_code, full_name, mobile, branch_display_name,
        applied_for_branch, applied_for_process, role_applied, experience,
        q_token, status, current_stage, created_at, updated_at
      ) VALUES (?, 'CAND-TEST-001', 'Assessment Test Candidate', ?, 'Noida',
                'Noida', 'Back Office Data Entry', 'Back Office', 'Fresher',
                ?, 'Waiting', 'Arrived', NOW(), NOW())`,
      [candidateId, mobile, queueToken],
    );
    await db.execute(
      `INSERT INTO ats_queue_token (
        id, candidate_id, token, token_number, status, queue_status, created_at, updated_at
      ) VALUES (?, ?, UUID(), ?, 'active', 'waiting', NOW(), NOW())`,
      [queueTokenId, candidateId, queueToken],
    );
  });

  afterAll(async () => {
    await db.execute("DELETE FROM ats_assessment_audit_log");
    await db.execute("DELETE FROM ats_typing_test_attempt");
    await db.execute("DELETE FROM ats_assessment_response");
    await db.execute("DELETE FROM ats_candidate_assessment");
    await db.execute("DELETE FROM ats_assessment_mapping");
    await db.execute("DELETE FROM ats_assessment_template");
    await db.execute("DELETE FROM ats_queue_token");
    await db.execute("DELETE FROM ats_candidate");
  });

  it("completes one assessment, permits exactly two typing attempts, and preserves ATS status", async () => {
    const assignment = await assessmentService.lookupOrAssignAssessment({
      queueToken,
      mobile,
      meta: { actorType: "candidate", ip: "127.0.0.1", userAgent: "vitest" },
    });
    expect(assignment.assessment.status).toBe("assigned");
    expect(assignment.assessment.maxAssessmentAttempts).toBe(1);
    expect(assignment.assessment.maxTypingAttempts).toBe(2);

    const repeatedLookup = await assessmentService.lookupOrAssignAssessment({ queueToken, mobile });
    expect(repeatedLookup.assessment.id).toBe(assignment.assessment.id);

    const started = await assessmentService.startAssessment(assignment.token);
    expect(started.assessment.status).toBe("in_progress");
    expect(started.assessment.template.questions).toHaveLength(10);

    const definition = getDefaultTemplate("backoffice", "executive");
    for (const question of definition.questions) {
      const answer = question.correctAnswer;
      expect(answer).toBeTruthy();
      await assessmentService.saveResponse(
        assignment.token,
        question.id,
        answer,
        10,
      );
    }

    const typingOne = await assessmentService.startTypingAttempt(assignment.token);
    const typingOneResult = await assessmentService.submitTypingAttempt(
      assignment.token,
      typingOne.id,
      { typedText: definition.typing.passage, backspaceCount: 0, pasteAttempts: 0 },
    );
    expect(typingOneResult.attemptNo).toBe(1);
    expect(typingOneResult.accuracy).toBe(100);
    expect(typingOneResult.attemptsRemaining).toBe(1);

    const typingTwo = await assessmentService.startTypingAttempt(assignment.token);
    const typingTwoResult = await assessmentService.submitTypingAttempt(
      assignment.token,
      typingTwo.id,
      { typedText: `${definition.typing.passage} extra`, backspaceCount: 1, pasteAttempts: 0 },
    );
    expect(typingTwoResult.attemptNo).toBe(2);
    expect(typingTwoResult.attemptsRemaining).toBe(0);

    await expect(
      assessmentService.startTypingAttempt(assignment.token),
    ).rejects.toMatchObject({ code: "TYPING_ATTEMPTS_USED" });

    const submitted = await assessmentService.submitAssessment(assignment.token);
    expect(submitted.status).toBe("completed");
    expect(submitted.result).toBe("pass");
    expect(submitted.manualReviewRequired).toBe(false);
    expect(submitted.typing?.attemptNo).toBe(1);

    const duplicateSubmit = await assessmentService.submitAssessment(assignment.token);
    expect(duplicateSubmit.alreadySubmitted).toBe(true);

    const [attemptRows] = await db.execute<any[]>(
      "SELECT COUNT(*) AS total FROM ats_candidate_assessment WHERE candidate_id = ?",
      [candidateId],
    );
    expect(Number(attemptRows[0]?.total)).toBe(1);

    const [typingRows] = await db.execute<any[]>(
      "SELECT COUNT(*) AS total FROM ats_typing_test_attempt WHERE assessment_id = ?",
      [assignment.assessment.id],
    );
    expect(Number(typingRows[0]?.total)).toBe(2);

    const [queueRows] = await db.execute<any[]>(
      "SELECT status, queue_status FROM ats_queue_token WHERE id = ?",
      [queueTokenId],
    );
    expect(queueRows[0]).toMatchObject({ status: "active", queue_status: "waiting" });

    const [candidateRows] = await db.execute<any[]>(
      "SELECT status, current_stage FROM ats_candidate WHERE id = ?",
      [candidateId],
    );
    expect(candidateRows[0]).toMatchObject({ status: "Waiting", current_stage: "Arrived" });
  });
});
