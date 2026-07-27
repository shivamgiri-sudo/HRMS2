from pathlib import Path


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
count = text.count(old)
if count != 1:
    raise SystemExit(f"catalog typing policy mismatch: {count}")
catalog.write_text(text.replace(old, new, 1))
