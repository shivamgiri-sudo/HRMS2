from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label} mismatch: {count}")
    return text.replace(old, new, 1)


qbank = Path("backend/src/modules/ats-assessment/question-bank.service.ts")
text = qbank.read_text()
text = replace_once(
    text,
    'import { mergeTypingDefinition } from "./assessment.catalog.js";',
    'import { mergeTypingDefinition, typingBenchmarksFor } from "./assessment.catalog.js";',
    "question bank benchmark import",
)
text = replace_once(
    text,
    '''      const wordCount = p.passageText.trim().split(/\s+/).length;
      const charCount = p.passageText.length;

      await db.execute(''',
    '''      const passageCode = String(p.passageCode ?? "").trim();
      const title = String(p.title ?? "").trim();
      const passageText = String(p.passageText ?? "").trim();
      if (!passageCode || !title || !passageText) {
        throw new Error("Passage code, title and passage text are required");
      }
      const wordCount = passageText.split(/\s+/).filter(Boolean).length;
      const charCount = Array.from(passageText).length;
      if (wordCount < 30 || charCount < 150) {
        throw new Error("Typing passage must contain at least 30 words and 150 characters");
      }
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
