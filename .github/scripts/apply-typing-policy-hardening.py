from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label} mismatch: {count}")
    return text.replace(old, new, 1)


# Memory-bound the character edit matrix and avoid storing a second full matrix
# merely to locate the attempted reference prefix.
scoring = Path("backend/src/modules/ats-assessment/typing-scoring.ts")
text = scoring.read_text()
text = replace_once(
    text,
    "const safeSeconds = (value: number) => Math.max(1, Number.isFinite(value) ? value : 1);",
    """const safeSeconds = (value: number) => Math.max(1, Number.isFinite(value) ? value : 1);
export const MAX_TYPING_SCORE_CHARACTERS = 2_500;""",
    "scoring length constant",
)
text = replace_once(
    text,
    "  const matrix = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));",
    "  const matrix = Array.from({ length: rows }, () => new Uint32Array(columns));",
    "typed edit matrix",
)
text = replace_once(
    text,
    "  matrix: number[][],",
    "  matrix: ReadonlyArray<ArrayLike<number>>,",
    "backtrack matrix type",
)
old_resolver_start = text.index("export function resolveAttemptedReference")
old_resolver_end = text.index("\nfunction analyzeAttempt", old_resolver_start)
new_resolver = '''export function resolveAttemptedReference(referenceText: string, typedText: string) {
  const reference = normalizeTypingText(referenceText);
  const typed = normalizeTypingText(typedText);
  const expected = Array.from(reference);
  const actual = Array.from(typed);

  if (!actual.length) {
    return {
      reference,
      typed,
      attemptedReference: "",
      referenceCharactersEvaluated: 0,
    };
  }

  // Only the final distance for each reference prefix is needed here. Rolling
  // rows keep memory O(typed characters), rather than O(reference × typed).
  let previous = new Uint32Array(actual.length + 1);
  for (let column = 0; column <= actual.length; column += 1) previous[column] = column;
  let bestPrefixLength = 0;
  let bestDistance = previous[actual.length];

  for (let row = 1; row <= expected.length; row += 1) {
    const current = new Uint32Array(actual.length + 1);
    current[0] = row;
    for (let column = 1; column <= actual.length; column += 1) {
      const substitutionCost = expected[row - 1] === actual[column - 1] ? 0 : 1;
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + substitutionCost,
      );
    }
    const distance = current[actual.length];
    if (distance < bestDistance || (distance === bestDistance && row > bestPrefixLength)) {
      bestDistance = distance;
      bestPrefixLength = row;
    }
    previous = current;
  }

  return {
    reference,
    typed,
    attemptedReference: expected.slice(0, bestPrefixLength).join(""),
    referenceCharactersEvaluated: bestPrefixLength,
  };
}
'''
text = text[:old_resolver_start] + new_resolver + text[old_resolver_end:]
text = replace_once(
    text,
    """  const resolved = resolveAttemptedReference(referenceText, typedText);
  const referenceCharacters = Array.from(resolved.reference).length;
  const typedCharacters = Array.from(resolved.typed).length;""",
    """  const resolved = resolveAttemptedReference(referenceText, typedText);
  const referenceCharacters = Array.from(resolved.reference).length;
  const typedCharacters = Array.from(resolved.typed).length;
  if (referenceCharacters > MAX_TYPING_SCORE_CHARACTERS || typedCharacters > MAX_TYPING_SCORE_CHARACTERS) {
    throw new RangeError(`Typing text exceeds the ${MAX_TYPING_SCORE_CHARACTERS}-character scoring limit`);
  }""",
    "scoring length guard",
)
scoring.write_text(text)


catalog = Path("backend/src/modules/ats-assessment/assessment.catalog.ts")
text = catalog.read_text()
old = '''const typingFor = (process: AssessmentProcess, role: AssessmentRole): TypingDefinition => ({
  required: ["backoffice", "document", "email"].includes(process),
  durationSeconds: 180,
  minNetWpm: role === "team_leader" ? 35 : role === "quality_auditor" ? 32 : 30,
  minAccuracy: process === "document" ? 98 : role === "quality_auditor" ? 97 : 95,
  maxAttempts: 2,
  passage: PASSAGES[process],
});'''
new = '''export function typingBenchmarksFor(process: AssessmentProcess, role: AssessmentRole) {
  return {
    minNetWpm: role === "team_leader" ? 35 : role === "quality_auditor" ? 32 : 30,
    minAccuracy: process === "document" ? 98 : role === "quality_auditor" ? 97 : 95,
  };
}

export function mergeTypingDefinition(base: TypingDefinition, selected: TypingDefinition): TypingDefinition {
  return {
    ...selected,
    minNetWpm: Math.max(base.minNetWpm, selected.minNetWpm),
    minAccuracy: Math.max(base.minAccuracy, selected.minAccuracy),
    maxAttempts: Math.min(base.maxAttempts, selected.maxAttempts),
  };
}

const typingFor = (process: AssessmentProcess, role: AssessmentRole): TypingDefinition => ({
  required: ["backoffice", "document", "email"].includes(process),
  durationSeconds: 180,
  ...typingBenchmarksFor(process, role),
  maxAttempts: 2,
  passage: PASSAGES[process],
});'''
text = replace_once(text, old, new, "catalog typing policy")
catalog.write_text(text)


qbank = Path("backend/src/modules/ats-assessment/question-bank.service.ts")
text = qbank.read_text()
text = replace_once(
    text,
    '''  type QuestionType,
  type TypingDefinition,
} from "./assessment.catalog.js";''',
    '''  type QuestionType,
  type TypingDefinition,
  mergeTypingDefinition,
  typingBenchmarksFor,
} from "./assessment.catalog.js";''',
    "question bank policy imports",
)
text = replace_once(
    text,
    '''      WHERE active_status = 1
        AND set_number = ?
        AND (process_key = ? OR process_key = 'any')
        AND (role_key = ? OR role_key = 'any')
      ORDER BY RAND()''',
    '''      WHERE active_status = 1
        AND set_number = ?
        AND (process_key = ? OR process_key = 'any')
        AND (role_key = ? OR role_key = 'any')
        AND word_count >= 30
        AND character_count BETWEEN 150 AND 2500
      ORDER BY RAND()''',
    "question bank passage quality filter",
)
text = replace_once(
    text,
    "      typing: passageResult?.typing ?? baseTemplate.typing,",
    "      typing: passageResult ? mergeTypingDefinition(baseTemplate.typing, passageResult.typing) : baseTemplate.typing,",
    "question bank policy floor",
)
text = replace_once(
    text,
    '''      const wordCount = p.passageText.trim().split(/\s+/).length;
      const charCount = p.passageText.length;

      await db.execute(''',
    '''      const passageCode = String(p.passageCode ?? "").trim();
      const title = String(p.title ?? "").trim();
      const passageText = String(p.passageText ?? "").trim();
      if (!passageCode || !title || !passageText) throw new Error("Passage code, title and passage text are required");
      const wordCount = passageText.split(/\s+/).filter(Boolean).length;
      const charCount = Array.from(passageText).length;
      if (wordCount < 30 || charCount < 150) throw new Error("Typing passage must contain at least 30 words and 150 characters");
      if (charCount > 2500) throw new Error("Typing passage cannot exceed 2500 characters");
      const durationSeconds = Number(p.recommendedDurationSeconds ?? 180);
      if (!Number.isFinite(durationSeconds) || durationSeconds < 60 || durationSeconds > 600) {
        throw new Error("Typing duration must be between 60 and 600 seconds");
      }
      const policy = typingBenchmarksFor(
        p.processKey === "any" ? "backoffice" : p.processKey,
        p.roleKey === "any" ? "executive" : p.roleKey,
      );
      const requestedWpm = Number(p.minWpmBenchmark ?? policy.minNetWpm);
      const requestedAccuracy = Number(p.minAccuracyBenchmark ?? policy.minAccuracy);
      if (!Number.isFinite(requestedWpm) || requestedWpm < 10 || requestedWpm > 100) {
        throw new Error("Net WPM benchmark must be between 10 and 100");
      }
      if (!Number.isFinite(requestedAccuracy) || requestedAccuracy < 80 || requestedAccuracy > 100) {
        throw new Error("Accuracy benchmark must be between 80 and 100");
      }
      const minWpmBenchmark = Math.max(policy.minNetWpm, requestedWpm);
      const minAccuracyBenchmark = Math.max(policy.minAccuracy, requestedAccuracy);

      await db.execute(''',
    "question bank import validation",
)
text = replace_once(text, "          p.passageCode,", "          passageCode,", "passage code value")
text = replace_once(text, "          p.title,\n          p.passageText,", "          title,\n          passageText,", "passage content values")
text = replace_once(
    text,
    '''          p.recommendedDurationSeconds ?? 180,
          p.minWpmBenchmark ?? 30,
          p.minAccuracyBenchmark ?? 92,''',
    '''          durationSeconds,
          minWpmBenchmark,
          minAccuracyBenchmark,''',
    "passage governed benchmark values",
)
qbank.write_text(text)


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
old_serialize_start = text.index("function serializeTyping(row: TypingRow")
old_serialize_end = text.index("\nasync function expireUnstartedAttempt", old_serialize_start)
new_serialize = '''function serializeTyping(row: TypingRow, includeReference = false) {
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
}
'''
text = text[:old_serialize_start] + new_serialize + text[old_serialize_end:]
text = replace_once(
    text,
    '''          score: typing[0].score_percentage,
          passedBenchmark: Boolean(typing[0].passed_benchmark),''',
    '''          score: typing[0].score_percentage,
          completionPercentage: Number(
            parseJson<Record<string, unknown>>(typing[0].result_json, {}).completionPercentage ?? 0,
          ),
          scoringVersion: String(
            parseJson<Record<string, unknown>>(typing[0].result_json, {}).scoringVersion ?? "typing-score-v1",
          ),
          passedBenchmark: Boolean(typing[0].passed_benchmark),''',
    "candidate summary completion",
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


page = Path("backend/src/modules/ats-assessment/assessment.page.ts")
text = page.read_text()
text = replace_once(
    text,
    '"% accuracy · "+Number(attempt.score||0).toFixed(1)+"% score',
    '"% accuracy · "+Number(attempt.completionPercentage||0).toFixed(1)+"% completion · "+Number(attempt.score||0).toFixed(1)+"% score',
    "candidate submitted-attempt completion",
)
text = replace_once(
    text,
    '''$("typingAccuracy").textContent=attempted.accuracy.toFixed(1)+"%";$("typingCharacters").textContent=Array.from(text).length;const remaining''',
    '''$("typingAccuracy").textContent=attempted.accuracy.toFixed(1)+"%";$("typingCharacters").textContent=Array.from(text).length;const referenceCharacters=Array.from(typingState.passage).length;const completion=referenceCharacters?Math.min(100,attempted.prefixLength/referenceCharacters*100):0;if($("typingCompletion"))$("typingCompletion").textContent=completion.toFixed(1)+"%";const remaining''',
    "candidate live completion calculation",
)
text = replace_once(
    text,
    '''<div class="metric"><b id="typingCharacters">0</b><span>Characters</span></div></div><div class="notice warning">''',
    '''<div class="metric"><b id="typingCharacters">0</b><span>Characters</span></div><div class="metric"><b id="typingCompletion">0%</b><span>Completion</span></div></div><div class="notice warning">''',
    "candidate live completion metric",
)
text = replace_once(
    text,
    '''<div class="metrics"><div class="metric"><b>'+Number(result.netWpm||0).toFixed(1)+'</b><span>Net WPM</span></div><div class="metric"><b>'+Number(result.accuracy||0).toFixed(1)+'%</b><span>Accuracy</span></div><div class="metric"><b>'+esc(result.correctWords||0)+'</b><span>Correct Words</span></div><div class="metric"><b>'+esc(result.incorrectWords||0)+'</b><span>Word Errors</span></div></div>''',
    '''<div class="metrics"><div class="metric"><b>'+Number(result.grossWpm||0).toFixed(1)+'</b><span>Gross WPM</span></div><div class="metric"><b>'+Number(result.netWpm||0).toFixed(1)+'</b><span>Net WPM</span></div><div class="metric"><b>'+Number(result.accuracy||0).toFixed(1)+'%</b><span>Accuracy</span></div><div class="metric"><b>'+Number(result.completionPercentage||0).toFixed(1)+'%</b><span>Completion</span></div></div>''',
    "candidate final typing metrics",
)
page.write_text(text)


admin = Path("backend/src/modules/ats-assessment/assessment.admin.page.ts")
text = admin.read_text()
text = replace_once(
    text,
    '''Number(row.best_net_wpm).toFixed(1)+" WPM · "+Number(row.best_accuracy||0).toFixed(1)+"%"''',
    '''Number(row.best_net_wpm).toFixed(1)+" WPM · "+Number(row.best_accuracy||0).toFixed(1)+"% accuracy · "+Number(row.best_completion_percentage||0).toFixed(1)+"% complete"''',
    "admin list coherent typing metrics",
)
text = replace_once(
    text,
    '''esc(t.netWpm??0)+" WPM · "+esc(t.accuracy??0)+"% accuracy · "+badge(t.passedBenchmark?"Passed benchmark":"Benchmark not met")''',
    '''esc(t.netWpm??0)+" WPM · "+esc(t.accuracy??0)+"% accuracy · "+Number(t.completionPercentage||0).toFixed(1)+"% completion · "+badge(t.passedBenchmark?"Passed benchmark":"Benchmark not met")''',
    "admin detail completion",
)
admin.write_text(text)


readme = Path("backend/src/modules/ats-assessment/README.md")
text = readme.read_text()
text = replace_once(
    text,
    "- standard data-entry accuracy benchmark of 95%, QA benchmark of 97%, and critical document benchmark of 98%",
    """- standard data-entry accuracy benchmark of 95%, QA benchmark of 97%, and critical document benchmark of 98%
- question-bank passages may raise but never lower the assigned template benchmark
- passage imports require 30+ words, 150-2500 characters and a 60-600 second duration
- recruiter summaries use all metrics from the same pass-first best attempt""",
    "README policy hardening",
)
readme.write_text(text)
