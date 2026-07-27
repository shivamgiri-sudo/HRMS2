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
    '''import type {
  AssessmentProcess,
  AssessmentQuestionDefinition,
  AssessmentRole,
  AssessmentTemplateDefinition,
  DifficultyLevel,
  QuestionType,
  TypingDefinition,
} from "./assessment.catalog.js";''',
    '''import { mergeTypingDefinition } from "./assessment.catalog.js";
import type {
  AssessmentProcess,
  AssessmentQuestionDefinition,
  AssessmentRole,
  AssessmentTemplateDefinition,
  DifficultyLevel,
  QuestionType,
  TypingDefinition,
} from "./assessment.catalog.js";''',
    "question bank policy imports",
)
text = replace_once(
    text,
    '''     FROM ats_typing_passage_bank
     WHERE active_status = 1
       AND set_number = ?
       AND (process_key = ? OR process_key = 'any')
       AND (role_key = ? OR role_key = 'any')
     ORDER BY RAND()''',
    '''     FROM ats_typing_passage_bank
     WHERE active_status = 1
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
qbank.write_text(text)
