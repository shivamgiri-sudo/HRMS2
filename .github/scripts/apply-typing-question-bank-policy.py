from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label} mismatch: {count}")
    return text.replace(old, new, 1)


catalog = Path("backend/src/modules/ats-assessment/assessment.catalog.ts")
text = catalog.read_text()
text = replace_once(
    text,
    '''const typingFor = (process: AssessmentProcess, role: AssessmentRole): TypingDefinition => ({
  required: ["backoffice", "document", "email"].includes(process),
  durationSeconds: 180,
  minNetWpm: role === "team_leader" ? 35 : role === "quality_auditor" ? 32 : 30,
  minAccuracy: process === "document" ? 98 : role === "quality_auditor" ? 97 : 95,
  maxAttempts: 2,
  passage: PASSAGES[process],
});''',
    '''export function typingBenchmarksFor(process: AssessmentProcess, role: AssessmentRole) {
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
});''',
    "catalog typing policy",
)
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

pattern = re.compile(
    r'''      const wordCount = p\.passageText\.trim\(\)\.split\(/\\s\+/\)\.length;\n'''
    r'''      const charCount = p\.passageText\.length;\n\n'''
    r'''      await db\.execute\(''',
)
replacement = '''      const passageCode = String(p.passageCode ?? "").trim();
      const title = String(p.title ?? "").trim();
      const passageText = String(p.passageText ?? "").trim();
      if (!passageCode || !title || !passageText) throw new Error("Passage code, title and passage text are required");
      const wordCount = passageText.split(/\\s+/).filter(Boolean).length;
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

      await db.execute('''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f"question bank import validation mismatch: {count}")

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
