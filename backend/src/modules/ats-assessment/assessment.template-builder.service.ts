import { createHash, randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import {
  type AssessmentProcess,
  type AssessmentQuestionDefinition,
  type AssessmentRole,
  type AssessmentTemplateDefinition,
} from "./assessment.catalog.js";
import { assessmentService } from "./assessment.service.js";

const PROCESS_VALUES = new Set<AssessmentProcess>([
  "inbound",
  "outbound",
  "backoffice",
  "document",
  "email",
]);
const ROLE_VALUES = new Set<AssessmentRole>([
  "executive",
  "team_leader",
  "quality_auditor",
]);
const DIFFICULTY_VALUES = new Set(["basic", "intermediate", "advanced"]);
const EXPERIENCE_VALUES = new Set(["any", "fresher", "experienced"]);

function appError(message: string, code = "INVALID_TEMPLATE") {
  return Object.assign(new Error(message), { statusCode: 400, code });
}

function uniqueStrings(value: unknown, maximum: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, maximum);
}

function validateQuestion(
  entry: unknown,
  index: number,
  defaultDifficulty: AssessmentTemplateDefinition["difficulty"],
  questionIds: Set<string>,
): AssessmentQuestionDefinition {
  const question = entry as Record<string, unknown>;
  const id = String(question.id ?? "").trim();
  const sectionKey = String(question.sectionKey ?? "").trim();
  const sectionTitle = String(question.sectionTitle ?? "").trim();
  const type = String(question.type ?? "") as AssessmentQuestionDefinition["type"];
  const prompt = String(question.prompt ?? "").trim();
  const difficulty = String(
    question.difficulty ?? defaultDifficulty,
  ) as AssessmentQuestionDefinition["difficulty"];
  const marks = Number(question.marks);

  if (!/^[A-Za-z0-9_-]{2,120}$/.test(id) || questionIds.has(id)) {
    throw appError(`Question ${index + 1} has an invalid or duplicate ID`);
  }
  questionIds.add(id);
  if (!sectionKey || sectionKey.length > 100 || !sectionTitle || sectionTitle.length > 150) {
    throw appError(`Question ${index + 1} requires a valid section key and title`);
  }
  if (!["single", "multi", "text"].includes(type) || !DIFFICULTY_VALUES.has(difficulty)) {
    throw appError(`Question ${index + 1} has an invalid type or difficulty`);
  }
  if (prompt.length < 10 || prompt.length > 5000) {
    throw appError(`Question ${index + 1} prompt must contain 10 to 5,000 characters`);
  }
  if (!Number.isFinite(marks) || marks < 1 || marks > 100) {
    throw appError(`Question ${index + 1} marks must be between 1 and 100`);
  }

  const output: AssessmentQuestionDefinition = {
    id,
    sectionKey,
    sectionTitle,
    type,
    prompt,
    marks,
    difficulty,
    manualReview: Boolean(question.manualReview),
  };

  if (type === "single" || type === "multi") {
    const options = uniqueStrings(question.options, 10);
    if (options.length < 2 || options.some((option) => option.length > 1000)) {
      throw appError(`Question ${index + 1} must contain 2 to 10 unique options`);
    }
    output.options = options;
    output.manualReview = false;
    if (type === "single") {
      const answer = String(question.correctAnswer ?? "").trim();
      if (!options.includes(answer)) {
        throw appError(`Question ${index + 1} correct answer must match an option`);
      }
      output.correctAnswer = answer;
    } else {
      const answers = uniqueStrings(question.correctAnswer, 10);
      if (!answers.length || answers.some((answer) => !options.includes(answer))) {
        throw appError(
          `Question ${index + 1} multiple-choice answers must match its options`,
        );
      }
      output.correctAnswer = answers;
    }
  } else {
    output.keywords = uniqueStrings(question.keywords, 50);
    output.manualReview = Boolean(question.manualReview);
  }

  return output;
}

export function validateCustomAssessmentTemplate(
  input: unknown,
): AssessmentTemplateDefinition {
  const raw = input as Record<string, unknown>;
  const code = String(raw.code ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  const name = String(raw.name ?? "").trim().slice(0, 255);
  if (code.length < 3 || name.length < 3) {
    throw appError("Template code and name must contain at least three characters");
  }

  const process = raw.process as AssessmentProcess;
  const role = raw.role as AssessmentRole;
  const difficulty = String(
    raw.difficulty ?? "",
  ) as AssessmentTemplateDefinition["difficulty"];
  const experienceLevel = String(
    raw.experienceLevel ?? "any",
  ) as AssessmentTemplateDefinition["experienceLevel"];
  if (!PROCESS_VALUES.has(process) || !ROLE_VALUES.has(role)) {
    throw appError("Select a valid assessment process and role");
  }
  if (!DIFFICULTY_VALUES.has(difficulty) || !EXPERIENCE_VALUES.has(experienceLevel)) {
    throw appError("Select valid difficulty and experience levels");
  }

  const durationMinutes = Number(raw.durationMinutes);
  const passingPercentage = Number(raw.passingPercentage);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 180) {
    throw appError("Assessment duration must be between 5 and 180 minutes");
  }
  if (!Number.isFinite(passingPercentage) || passingPercentage < 1 || passingPercentage > 100) {
    throw appError("Passing percentage must be between 1 and 100");
  }

  const instructions = uniqueStrings(raw.instructions, 20);
  if (!instructions.length || instructions.some((instruction) => instruction.length > 500)) {
    throw appError("Provide between 1 and 20 concise candidate instructions");
  }

  const rawTyping = (raw.typing ?? {}) as Record<string, unknown>;
  const typingRequired = Boolean(rawTyping.required);
  const typingDuration = Number(rawTyping.durationSeconds ?? 180);
  const minNetWpm = Number(rawTyping.minNetWpm ?? 30);
  const minAccuracy = Number(rawTyping.minAccuracy ?? 92);
  const maxAttempts = Number(rawTyping.maxAttempts ?? 2);
  const passage = typingRequired ? String(rawTyping.passage ?? "").trim() : "";
  if (maxAttempts !== 2) throw appError("Typing attempts must remain fixed at two");
  if (!Number.isInteger(typingDuration) || typingDuration < 30 || typingDuration > 900) {
    throw appError("Typing duration must be between 30 and 900 seconds");
  }
  if (!Number.isFinite(minNetWpm) || minNetWpm < 1 || minNetWpm > 150) {
    throw appError("Typing net-WPM benchmark must be between 1 and 150");
  }
  if (!Number.isFinite(minAccuracy) || minAccuracy < 1 || minAccuracy > 100) {
    throw appError("Typing accuracy benchmark must be between 1 and 100");
  }
  if (typingRequired && (passage.length < 80 || passage.length > 5000)) {
    throw appError("A required typing passage must contain 80 to 5,000 characters");
  }

  if (!Array.isArray(raw.questions) || raw.questions.length < 1 || raw.questions.length > 100) {
    throw appError("Template must contain between 1 and 100 questions");
  }
  const questionIds = new Set<string>();
  const questions = raw.questions.map((entry, index) =>
    validateQuestion(entry, index, difficulty, questionIds),
  );

  return {
    code,
    name,
    process,
    role,
    experienceLevel,
    durationMinutes,
    passingPercentage,
    difficulty,
    instructions,
    typing: {
      required: typingRequired,
      durationSeconds: typingDuration,
      minNetWpm,
      minAccuracy,
      maxAttempts: 2,
      passage,
    },
    questions,
  };
}

interface TemplateVersionRow extends RowDataPacket {
  template_version: number;
}

export async function saveCustomAssessmentTemplate(input: unknown, actorId: string) {
  if (!assessmentService.isAssessmentEnabled()) {
    throw Object.assign(new Error("Candidate assessment is currently disabled"), {
      statusCode: 503,
      code: "ASSESSMENT_DISABLED",
    });
  }
  await assessmentService.ensureAssessmentSchema();
  const template = validateCustomAssessmentTemplate(input);
  const [existingRows] = await db.execute<TemplateVersionRow[]>(
    `SELECT template_version
     FROM ats_assessment_template
     WHERE template_code = ?
     ORDER BY template_version DESC
     LIMIT 1`,
    [template.code],
  );
  const version = Number(existingRows[0]?.template_version ?? 0) + 1;
  const contentHash = createHash("sha256")
    .update(JSON.stringify(template))
    .digest("hex");
  const id = randomUUID();

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE ats_assessment_template
       SET active_status = 0
       WHERE template_code = ? AND source_type = 'custom'`,
      [template.code],
    );
    await connection.execute(
      `INSERT INTO ats_assessment_template (
        id, template_code, template_name, process_key, role_key, experience_level,
        difficulty_level, duration_minutes, passing_percentage, gate_mode,
        template_version, content_hash, config_json, source_type, active_status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'advisory', ?, ?, CAST(? AS JSON), 'custom', 1, ?)`,
      [
        id,
        template.code,
        template.name,
        template.process,
        template.role,
        template.experienceLevel,
        template.difficulty,
        template.durationMinutes,
        template.passingPercentage,
        version,
        contentHash,
        JSON.stringify(template),
        actorId,
      ],
    );
    await connection.commit();
    return { id, code: template.code, version };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
