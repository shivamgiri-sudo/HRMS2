from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label} mismatch: {count}")
    return text.replace(old, new, 1)


service = Path("backend/src/modules/ats-assessment/assessment.service.ts")
text = service.read_text()
text = replace_once(
    text,
    'import { calculateTypingScore } from "./typing-scoring.js";',
    'import { calculateTypingScore, MAX_TYPING_SCORE_CHARACTERS } from "./typing-scoring.js";',
    "scoring limit import",
)
text = replace_once(
    text,
    "const MAX_TYPING_TEXT_LENGTH = 20_000;",
    "const MAX_TYPING_TEXT_LENGTH = MAX_TYPING_SCORE_CHARACTERS;",
    "typing input limit",
)
text = replace_once(
    text,
    '''    if (!definition.typing.required) {
      throw appError("Typing test is not required for this assessment", 400, "TYPING_NOT_REQUIRED");
    }

    const active''',
    '''    if (!definition.typing.required) {
      throw appError("Typing test is not required for this assessment", 400, "TYPING_NOT_REQUIRED");
    }
    const assessmentSecondsRemaining = getRemainingSeconds(attempt);
    if (
      assessmentSecondsRemaining !== null
      && assessmentSecondsRemaining < definition.typing.durationSeconds + 5
    ) {
      throw appError(
        "Not enough assessment time remains to start a complete typing attempt",
        409,
        "INSUFFICIENT_TIME_FOR_TYPING",
      );
    }

    const active''',
    "typing remaining-time guard",
)
text = replace_once(
    text,
    '''function serializeTyping(row: TypingRow, includeReference = false) {
  return {
    id: row.id,
    attemptNo: Number(row.attempt_no),
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    durationSeconds: Number(row.duration_limit_seconds),
    elapsedSeconds: row.elapsed_seconds,
    grossWpm: row.gross_wpm,
    netWpm: row.net_wpm,
    accuracy: row.accuracy_percentage,
    score: row.score_percentage,
    passedBenchmark: row.passed_benchmark === null ? null : Boolean(row.passed_benchmark),
    backspaceCount: Number(row.backspace_count ?? 0),
    pasteAttempts: Number(row.paste_attempts ?? 0),
    result: row.submitted_at ? parseJson(row.result_json, null) : null,
    active: !row.submitted_at,
    ...(includeReference ? { passage: row.reference_text } : {}),
  };
}''',
    '''function serializeTyping(row: TypingRow, includeReference = false) {
  const result = row.submitted_at
    ? parseJson<Record<string, unknown>>(row.result_json, {})
    : null;
  return {
    id: row.id,
    attemptNo: Number(row.attempt_no),
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    durationSeconds: Number(row.duration_limit_seconds),
    elapsedSeconds: row.elapsed_seconds,
    grossWpm: row.gross_wpm,
    netWpm: row.net_wpm,
    accuracy: row.accuracy_percentage,
    score: row.score_percentage,
    passedBenchmark: row.passed_benchmark === null ? null : Boolean(row.passed_benchmark),
    completionPercentage: result ? Number(result.completionPercentage ?? 0) : null,
    typedCharacters: result ? Number(result.typedCharacters ?? 0) : null,
    scoringVersion: result ? String(result.scoringVersion ?? "typing-score-v1") : null,
    backspaceCount: Number(row.backspace_count ?? 0),
    pasteAttempts: Number(row.paste_attempts ?? 0),
    result,
    active: !row.submitted_at,
    ...(includeReference ? { passage: row.reference_text } : {}),
  };
}''',
    "typing serializer",
)
text = replace_once(
    text,
    '''          accuracy: typing[0].accuracy_percentage,
          score: typing[0].score_percentage,
          passedBenchmark: Boolean(typing[0].passed_benchmark),''',
    '''          accuracy: typing[0].accuracy_percentage,
          score: typing[0].score_percentage,
          completionPercentage: Number(
            parseJson<Record<string, unknown>>(typing[0].result_json, {}).completionPercentage ?? 0,
          ),
          scoringVersion: String(
            parseJson<Record<string, unknown>>(typing[0].result_json, {}).scoringVersion ?? "typing-score-v1",
          ),
          passedBenchmark: Boolean(typing[0].passed_benchmark),''',
    "candidate result typing evidence",
)
text = replace_once(
    text,
    '''       a.completed_at, t.template_name, t.template_code, t.process_key, t.role_key,
       (SELECT MAX(net_wpm) FROM ats_typing_test_attempt x
        WHERE x.assessment_id = a.id AND x.submitted_at IS NOT NULL) AS best_net_wpm,
       (SELECT MAX(accuracy_percentage) FROM ats_typing_test_attempt x
        WHERE x.assessment_id = a.id AND x.submitted_at IS NOT NULL) AS best_accuracy,
       JSON_LENGTH(COALESCE(a.integrity_flags, JSON_ARRAY())) AS integrity_flag_count
     FROM ats_candidate_assessment a
     JOIN ats_candidate c ON c.id = a.candidate_id
     JOIN ats_assessment_template t ON t.id = a.template_id''',
    '''       a.completed_at, t.template_name, t.template_code, t.process_key, t.role_key,
       best_typing.net_wpm AS best_net_wpm,
       best_typing.accuracy_percentage AS best_accuracy,
       CAST(JSON_UNQUOTE(JSON_EXTRACT(best_typing.result_json, '$.completionPercentage')) AS DECIMAL(7,2))
         AS best_completion_percentage,
       JSON_LENGTH(COALESCE(a.integrity_flags, JSON_ARRAY())) AS integrity_flag_count
     FROM ats_candidate_assessment a
     JOIN ats_candidate c ON c.id = a.candidate_id
     JOIN ats_assessment_template t ON t.id = a.template_id
     LEFT JOIN ats_typing_test_attempt best_typing
       ON best_typing.id = (
         SELECT x.id
         FROM ats_typing_test_attempt x
         WHERE x.assessment_id = a.id AND x.submitted_at IS NOT NULL
         ORDER BY x.passed_benchmark DESC, x.score_percentage DESC,
                  x.accuracy_percentage DESC, x.net_wpm DESC, x.attempt_no ASC
         LIMIT 1
       )''',
    "coherent recruiter best attempt",
)
service.write_text(text)
