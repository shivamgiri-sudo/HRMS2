import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import type {
  AssessmentProcess,
  AssessmentQuestionDefinition,
  AssessmentRole,
  AssessmentTemplateDefinition,
  DifficultyLevel,
  QuestionType,
  TypingDefinition,
} from "./assessment.catalog.js";

type QuestionRow = RowDataPacket & {
  id: string;
  question_code: string;
  process_key: AssessmentProcess | "any";
  role_key: AssessmentRole | "any";
  section_key: string;
  section_title: string;
  question_type: QuestionType;
  difficulty_level: DifficultyLevel;
  prompt: string;
  options_json: string | string[] | null;
  correct_answer_json: string | string | string[] | null;
  keywords_json: string | string[] | null;
  explanation: string | null;
  marks: number;
  manual_review: number;
  set_number: number;
  active_status: number;
  usage_count: number;
};

type PassageRow = RowDataPacket & {
  id: string;
  passage_code: string;
  process_key: AssessmentProcess | "any";
  role_key: AssessmentRole | "any";
  difficulty_level: DifficultyLevel;
  title: string;
  passage_text: string;
  word_count: number;
  character_count: number;
  recommended_duration_seconds: number;
  min_wpm_benchmark: number;
  min_accuracy_benchmark: number;
  set_number: number;
  active_status: number;
  usage_count: number;
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Parses a JSON column that may contain either:
 * - A valid JSON-encoded value (e.g., "\"Saturday\"" or "[\"A\",\"B\"]")
 * - A plain string that wasn't JSON-encoded (e.g., "Saturday")
 *
 * If JSON.parse fails and the input is a non-empty string, returns
 * the string itself (for single) or an array of that string (for multi).
 */
function parseAnswerJson(
  value: unknown,
  type: "single" | "multi",
): string | string[] {
  const fallback = type === "multi" ? [] : "";

  if (value === null || value === undefined) return fallback;

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      // Validate the shape matches the expected type
      if (type === "multi" && Array.isArray(parsed)) return parsed;
      if (type === "single" && typeof parsed === "string") return parsed;
      // If JSON parsed but wrong shape, treat as plain string
      return type === "multi" ? [value] : value;
    } catch {
      // JSON.parse failed — treat as plain string value
      return type === "multi" ? [value] : value;
    }
  }

  // Already the correct type (e.g., mysql2 returned parsed JSON object)
  if (type === "multi" && Array.isArray(value)) return value;
  if (type === "single" && typeof value === "string") return value;

  return fallback;
}

function questionRowToDefinition(row: QuestionRow): AssessmentQuestionDefinition {
  const base: AssessmentQuestionDefinition = {
    id: row.question_code,
    sectionKey: row.section_key,
    sectionTitle: row.section_title,
    type: row.question_type,
    prompt: row.prompt,
    marks: Number(row.marks),
    difficulty: row.difficulty_level,
  };

  if (row.question_type === "single" || row.question_type === "multi") {
    base.options = parseJson<string[]>(row.options_json, []);
    base.correctAnswer = parseAnswerJson(row.correct_answer_json, row.question_type);
  }

  if (row.question_type === "text") {
    base.keywords = parseJson<string[]>(row.keywords_json, []);
    base.manualReview = Boolean(row.manual_review);
  }

  if (row.explanation) {
    base.explanation = row.explanation;
  }

  return base;
}

export async function getAvailableSetNumbers(
  process: AssessmentProcess,
  role: AssessmentRole,
): Promise<{ questionSets: number[]; passageSets: number[] }> {
  const [questionRows] = await db.execute<(RowDataPacket & { set_number: number })[]>(
    `SELECT DISTINCT set_number
     FROM ats_question_bank
     WHERE active_status = 1
       AND (process_key = ? OR process_key = 'any')
       AND (role_key = ? OR role_key = 'any')
     ORDER BY set_number`,
    [process, role],
  );

  const [passageRows] = await db.execute<(RowDataPacket & { set_number: number })[]>(
    `SELECT DISTINCT set_number
     FROM ats_typing_passage_bank
     WHERE active_status = 1
       AND (process_key = ? OR process_key = 'any')
       AND (role_key = ? OR role_key = 'any')
     ORDER BY set_number`,
    [process, role],
  );

  return {
    questionSets: questionRows.map((r) => r.set_number),
    passageSets: passageRows.map((r) => r.set_number),
  };
}

const QUESTIONS_PER_ASSESSMENT = 20;

export async function selectRandomQuestionSet(
  process: AssessmentProcess,
  role: AssessmentRole,
  _questionsPerSection: number = 10,
  excludeSets: number[] = [],
): Promise<{ setNumber: number; questions: AssessmentQuestionDefinition[] } | null> {
  // Pull all active questions for this process/role across all sets
  const [allRows] = await db.execute<QuestionRow[]>(
    `SELECT *
     FROM ats_question_bank
     WHERE active_status = 1
       AND (process_key = ? OR process_key = 'any')
       AND (role_key = ? OR role_key = 'any')
       ${excludeSets.length > 0 ? `AND set_number NOT IN (${excludeSets.map(() => "?").join(",")})` : ""}
     ORDER BY section_key`,
    [process, role, ...excludeSets],
  );

  if (allRows.length === 0) return null;

  // Shuffle and pick 20 — one per unique question code to avoid duplicates
  const shuffled = shuffleArray(allRows);
  const seen = new Set<string>();
  const picked: QuestionRow[] = [];
  for (const row of shuffled) {
    if (!seen.has(row.question_code) && picked.length < QUESTIONS_PER_ASSESSMENT) {
      seen.add(row.question_code);
      picked.push(row);
    }
  }

  const selectedIds = picked.map((r) => r.id);
  if (selectedIds.length > 0) {
    const placeholders = selectedIds.map(() => "?").join(",");
    await db.execute(
      `UPDATE ats_question_bank SET usage_count = usage_count + 1 WHERE id IN (${placeholders})`,
      selectedIds,
    );
  }

  // Use set_number 0 as a sentinel when pulling from mixed sets
  return { setNumber: 0, questions: shuffleArray(picked.map(questionRowToDefinition)) };
}

export async function selectRandomPassage(
  process: AssessmentProcess,
  role: AssessmentRole,
  excludeSets: number[] = [],
): Promise<{ setNumber: number; typing: TypingDefinition } | null> {
  const { passageSets } = await getAvailableSetNumbers(process, role);
  if (passageSets.length === 0) return null;

  const availableSets = passageSets.filter((s) => !excludeSets.includes(s));
  const targetSets = availableSets.length > 0 ? availableSets : passageSets;
  const selectedSet = targetSets[Math.floor(Math.random() * targetSets.length)];

  const [rows] = await db.execute<PassageRow[]>(
    `SELECT *
     FROM ats_typing_passage_bank
     WHERE active_status = 1
       AND set_number = ?
       AND (process_key = ? OR process_key = 'any')
       AND (role_key = ? OR role_key = 'any')
     ORDER BY RAND()
     LIMIT 1`,
    [selectedSet, process, role],
  );

  const passage = rows[0];
  if (!passage) return null;

  await db.execute(`UPDATE ats_typing_passage_bank SET usage_count = usage_count + 1 WHERE id = ?`, [passage.id]);

  return {
    setNumber: selectedSet,
    typing: {
      required: true,
      durationSeconds: passage.recommended_duration_seconds,
      minNetWpm: passage.min_wpm_benchmark,
      minAccuracy: Number(passage.min_accuracy_benchmark),
      maxAttempts: 2,
      passage: passage.passage_text,
    },
  };
}

export async function buildRandomizedTemplate(
  baseTemplate: AssessmentTemplateDefinition,
  excludeQuestionSets: number[] = [],
  excludePassageSets: number[] = [],
): Promise<{ config: AssessmentTemplateDefinition; fromBank: boolean }> {
  const [questionResult, passageResult] = await Promise.all([
    selectRandomQuestionSet(baseTemplate.process, baseTemplate.role, 10, excludeQuestionSets),
    baseTemplate.typing.required
      ? selectRandomPassage(baseTemplate.process, baseTemplate.role, excludePassageSets)
      : Promise.resolve(null),
  ]);

  const fromBank = questionResult !== null || passageResult !== null;
  return {
    config: {
      ...baseTemplate,
      questions: questionResult?.questions ?? baseTemplate.questions,
      typing: passageResult?.typing ?? baseTemplate.typing,
    },
    fromBank,
  };
}

export async function countQuestionBankStats(): Promise<{
  totalQuestions: number;
  totalPassages: number;
  byProcessRole: Array<{
    process: string;
    role: string;
    questionCount: number;
    passageCount: number;
    setCount: number;
  }>;
}> {
  const [questionCount] = await db.execute<(RowDataPacket & { count: number })[]>(
    `SELECT COUNT(*) as count FROM ats_question_bank WHERE active_status = 1`,
  );
  const [passageCount] = await db.execute<(RowDataPacket & { count: number })[]>(
    `SELECT COUNT(*) as count FROM ats_typing_passage_bank WHERE active_status = 1`,
  );

  const [byProcessRole] = await db.execute<
    (RowDataPacket & {
      process_key: string;
      role_key: string;
      question_count: number;
      set_count: number;
    })[]
  >(
    `SELECT process_key, role_key, COUNT(*) as question_count, COUNT(DISTINCT set_number) as set_count
     FROM ats_question_bank
     WHERE active_status = 1
     GROUP BY process_key, role_key`,
  );

  const [passageByProcessRole] = await db.execute<
    (RowDataPacket & { process_key: string; role_key: string; passage_count: number })[]
  >(
    `SELECT process_key, role_key, COUNT(*) as passage_count
     FROM ats_typing_passage_bank
     WHERE active_status = 1
     GROUP BY process_key, role_key`,
  );

  const passageMap = new Map(passageByProcessRole.map((p) => [`${p.process_key}:${p.role_key}`, p.passage_count]));

  return {
    totalQuestions: questionCount[0]?.count ?? 0,
    totalPassages: passageCount[0]?.count ?? 0,
    byProcessRole: byProcessRole.map((r) => ({
      process: r.process_key,
      role: r.role_key,
      questionCount: r.question_count,
      passageCount: passageMap.get(`${r.process_key}:${r.role_key}`) ?? 0,
      setCount: r.set_count,
    })),
  };
}

export async function importQuestions(
  questions: Array<{
    questionCode: string;
    processKey: AssessmentProcess | "any";
    roleKey: AssessmentRole | "any";
    sectionKey: string;
    sectionTitle: string;
    questionType: QuestionType;
    difficultyLevel: DifficultyLevel;
    prompt: string;
    options?: string[];
    correctAnswer?: string | string[];
    keywords?: string[];
    explanation?: string;
    marks: number;
    manualReview?: boolean;
    setNumber: number;
  }>,
  createdBy: string | null,
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const q of questions) {
    try {
      await db.execute(
        `INSERT INTO ats_question_bank (
          id, question_code, process_key, role_key, section_key, section_title,
          question_type, difficulty_level, prompt, options_json, correct_answer_json,
          keywords_json, explanation, marks, manual_review, set_number, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          process_key = VALUES(process_key),
          role_key = VALUES(role_key),
          section_key = VALUES(section_key),
          section_title = VALUES(section_title),
          question_type = VALUES(question_type),
          difficulty_level = VALUES(difficulty_level),
          prompt = VALUES(prompt),
          options_json = VALUES(options_json),
          correct_answer_json = VALUES(correct_answer_json),
          keywords_json = VALUES(keywords_json),
          explanation = VALUES(explanation),
          marks = VALUES(marks),
          manual_review = VALUES(manual_review),
          set_number = VALUES(set_number)`,
        [
          randomUUID(),
          q.questionCode,
          q.processKey,
          q.roleKey,
          q.sectionKey,
          q.sectionTitle,
          q.questionType,
          q.difficultyLevel,
          q.prompt,
          q.options ? JSON.stringify(q.options) : null,
          q.correctAnswer ? JSON.stringify(q.correctAnswer) : null,
          q.keywords ? JSON.stringify(q.keywords) : null,
          q.explanation ?? null,
          q.marks,
          q.manualReview ? 1 : 0,
          q.setNumber,
          createdBy,
        ],
      );
      imported++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${q.questionCode}: ${msg}`);
      skipped++;
    }
  }

  return { imported, skipped, errors };
}

export async function importPassages(
  passages: Array<{
    passageCode: string;
    processKey: AssessmentProcess | "any";
    roleKey: AssessmentRole | "any";
    difficultyLevel: DifficultyLevel;
    title: string;
    passageText: string;
    recommendedDurationSeconds?: number;
    minWpmBenchmark?: number;
    minAccuracyBenchmark?: number;
    setNumber: number;
  }>,
  createdBy: string | null,
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const p of passages) {
    try {
      const wordCount = p.passageText.trim().split(/\s+/).length;
      const charCount = p.passageText.length;

      await db.execute(
        `INSERT INTO ats_typing_passage_bank (
          id, passage_code, process_key, role_key, difficulty_level, title, passage_text,
          word_count, character_count, recommended_duration_seconds, min_wpm_benchmark,
          min_accuracy_benchmark, set_number, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          process_key = VALUES(process_key),
          role_key = VALUES(role_key),
          difficulty_level = VALUES(difficulty_level),
          title = VALUES(title),
          passage_text = VALUES(passage_text),
          word_count = VALUES(word_count),
          character_count = VALUES(character_count),
          recommended_duration_seconds = VALUES(recommended_duration_seconds),
          min_wpm_benchmark = VALUES(min_wpm_benchmark),
          min_accuracy_benchmark = VALUES(min_accuracy_benchmark),
          set_number = VALUES(set_number)`,
        [
          randomUUID(),
          p.passageCode,
          p.processKey,
          p.roleKey,
          p.difficultyLevel,
          p.title,
          p.passageText,
          wordCount,
          charCount,
          p.recommendedDurationSeconds ?? 180,
          p.minWpmBenchmark ?? 30,
          p.minAccuracyBenchmark ?? 92,
          p.setNumber,
          createdBy,
        ],
      );
      imported++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${p.passageCode}: ${msg}`);
      skipped++;
    }
  }

  return { imported, skipped, errors };
}

export async function listQuestions(filters: {
  process?: AssessmentProcess | "any";
  role?: AssessmentRole | "any";
  section?: string;
  setNumber?: number;
  limit?: number;
  offset?: number;
}): Promise<QuestionRow[]> {
  const conditions: string[] = ["active_status = 1"];
  const params: unknown[] = [];

  if (filters.process) {
    conditions.push("(process_key = ? OR process_key = 'any')");
    params.push(filters.process);
  }
  if (filters.role) {
    conditions.push("(role_key = ? OR role_key = 'any')");
    params.push(filters.role);
  }
  if (filters.section) {
    conditions.push("section_key = ?");
    params.push(filters.section);
  }
  if (filters.setNumber !== undefined) {
    conditions.push("set_number = ?");
    params.push(filters.setNumber);
  }

  const limit = Math.min(filters.limit ?? 100, 500);
  const offset = filters.offset ?? 0;

  const [rows] = await db.execute<QuestionRow[]>(
    `SELECT * FROM ats_question_bank
     WHERE ${conditions.join(" AND ")}
     ORDER BY set_number, section_key, question_code
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  return rows;
}

export async function listPassages(filters: {
  process?: AssessmentProcess | "any";
  role?: AssessmentRole | "any";
  setNumber?: number;
  limit?: number;
  offset?: number;
}): Promise<PassageRow[]> {
  const conditions: string[] = ["active_status = 1"];
  const params: unknown[] = [];

  if (filters.process) {
    conditions.push("(process_key = ? OR process_key = 'any')");
    params.push(filters.process);
  }
  if (filters.role) {
    conditions.push("(role_key = ? OR role_key = 'any')");
    params.push(filters.role);
  }
  if (filters.setNumber !== undefined) {
    conditions.push("set_number = ?");
    params.push(filters.setNumber);
  }

  const limit = Math.min(filters.limit ?? 100, 500);
  const offset = filters.offset ?? 0;

  const [rows] = await db.execute<PassageRow[]>(
    `SELECT * FROM ats_typing_passage_bank
     WHERE ${conditions.join(" AND ")}
     ORDER BY set_number, passage_code
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  return rows;
}

export async function deleteQuestion(questionCode: string): Promise<boolean> {
  const [result] = await db.execute(
    `UPDATE ats_question_bank SET active_status = 0 WHERE question_code = ?`,
    [questionCode],
  );
  return (result as unknown as { affectedRows: number }).affectedRows > 0;
}

export async function deletePassage(passageCode: string): Promise<boolean> {
  const [result] = await db.execute(
    `UPDATE ats_typing_passage_bank SET active_status = 0 WHERE passage_code = ?`,
    [passageCode],
  );
  return (result as unknown as { affectedRows: number }).affectedRows > 0;
}

export const questionBankService = {
  getAvailableSetNumbers,
  selectRandomQuestionSet,
  selectRandomPassage,
  buildRandomizedTemplate,
  countQuestionBankStats,
  importQuestions,
  importPassages,
  listQuestions,
  listPassages,
  deleteQuestion,
  deletePassage,
};
