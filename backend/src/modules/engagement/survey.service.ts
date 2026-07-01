import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { addPoints } from "./gamification.service.js";
import { queueAutoAwards } from "./badge.service.js";
import type {
  CreateSurveyDTO,
  PulseCheck,
  PulseCheckFilters,
  SubmitPulseCheckDTO,
  SubmitSurveyResponseDTO,
  SurveyFilters,
  SurveyMaster,
  SurveyQuestion,
  SurveyWithQuestionsResponse,
} from "./engagement.types.js";

export async function createSurvey(data: CreateSurveyDTO, createdBy: string): Promise<string> {
  const surveyId = randomUUID();
  await db.execute(
    `INSERT INTO survey_master
       (survey_id, survey_title, survey_description, survey_type, start_date, end_date,
        is_anonymous, is_active, points_reward, target_audience_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      surveyId,
      data.survey_title,
      data.survey_description ?? null,
      data.survey_type,
      data.start_date ?? null,
      data.end_date ?? null,
      data.is_anonymous ?? false,
      data.is_active ?? true,
      data.points_reward ?? 0,
      data.target_audience_json ? JSON.stringify(data.target_audience_json) : null,
      createdBy,
    ]
  );

  for (const question of data.questions) {
    await db.execute(
      `INSERT INTO survey_question
         (id, survey_id, question_text, question_type, display_order,
          is_required, options_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        surveyId,
        question.question_text,
        question.question_type,
        question.display_order ?? question.question_order,
        question.is_required ?? false,
        question.options_json ? JSON.stringify(question.options_json) : null,
      ]
    );
  }
  return surveyId;
}

export async function listSurveys(filters: SurveyFilters = {}): Promise<SurveyMaster[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.survey_type) {
    conditions.push("survey_type = ?");
    params.push(filters.survey_type);
  }
  if (filters.is_active !== undefined) {
    conditions.push("is_active = ?");
    params.push(filters.is_active);
  }
  if (filters.is_anonymous !== undefined) {
    conditions.push("is_anonymous = ?");
    params.push(filters.is_anonymous);
  }
  if (filters.date_from) {
    conditions.push("created_at >= ?");
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    conditions.push("created_at <= ?");
    params.push(filters.date_to);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM survey_master ${where} ORDER BY created_at DESC`,
    params
  );
  return rows as SurveyMaster[];
}

export async function getSurvey(id: string): Promise<SurveyWithQuestionsResponse | null> {
  const [surveyRows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM survey_master WHERE survey_id = ? LIMIT 1",
    [id]
  );
  if (!surveyRows[0]) return null;
  const [questionRows] = await db.execute<RowDataPacket[]>(
    `SELECT id AS question_id, survey_id, question_text, question_type,
            display_order, is_required, options_json, scale_min, scale_max
       FROM survey_question WHERE survey_id = ? ORDER BY display_order`,
    [id]
  );
  return { ...(surveyRows[0] as SurveyMaster), questions: questionRows as SurveyQuestion[] };
}

export async function submitSurveyResponse(data: SubmitSurveyResponseDTO): Promise<void> {
  const survey = await getSurvey(data.survey_id);
  if (!survey || !survey.is_active) throw new Error("Survey not found or inactive");

  if (data.employee_id && !survey.is_anonymous) {
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT response_id FROM survey_response WHERE survey_id = ? AND employee_id = ? LIMIT 1",
      [data.survey_id, data.employee_id]
    );
    if (existing.length) throw new Error("Survey already completed");
  }

  const validQuestions = new Set(survey.questions.map((question) => question.id));
  for (const response of data.responses) {
    if (!validQuestions.has(response.question_id)) throw new Error("Invalid survey question");
    await db.execute(
      `INSERT INTO survey_response
         (response_id, survey_id, question_id, employee_id, response_text,
          response_value, response_choices_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        data.survey_id,
        response.question_id,
        survey.is_anonymous ? null : data.employee_id ?? null,
        response.response_text ?? null,
        response.response_value ?? null,
        response.response_choices_json ? JSON.stringify(response.response_choices_json) : null,
      ]
    );
  }

  if (data.employee_id && !survey.is_anonymous && survey.points_reward > 0) {
    await addPoints(
      data.employee_id,
      survey.points_reward,
      "survey_completed",
      `Survey completed: ${survey.survey_title}`,
      data.survey_id
    );
  }
  if (data.employee_id && !survey.is_anonymous) {
    queueAutoAwards(data.employee_id, "survey_completed");
  }
}

export async function getSurveyResults(id: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT sq.id AS question_id, sq.question_text, sq.question_type,
            COUNT(sr.response_id) as response_count,
            AVG(sr.response_value) as average_value
       FROM survey_question sq
       LEFT JOIN survey_response sr ON sr.question_id = sq.id
      WHERE sq.survey_id = ?
      GROUP BY sq.id, sq.question_text, sq.question_type, sq.display_order
      ORDER BY sq.display_order`,
    [id]
  );
  return rows;
}

export async function calculateENPS(
  surveyId: string,
  questionId: string
): Promise<{ score: number; promoters: number; passives: number; detractors: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT response_value FROM survey_response
      WHERE survey_id = ? AND question_id = ? AND response_value IS NOT NULL`,
    [surveyId, questionId]
  );
  const values = rows.map((row) => Number(row.response_value));
  const promoters = values.filter((value) => value >= 9).length;
  const passives = values.filter((value) => value >= 7 && value <= 8).length;
  const detractors = values.filter((value) => value <= 6).length;
  const score = values.length ? Math.round(((promoters - detractors) / values.length) * 100) : 0;
  return { score, promoters, passives, detractors };
}

export async function submitPulseCheck(data: SubmitPulseCheckDTO): Promise<void> {
  await db.execute(
    `INSERT INTO pulse_check
       (pulse_id, employee_id, mood_rating, energy_level, stress_level,
        workload_perception, feedback_text, week_start_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       mood_rating = VALUES(mood_rating),
       energy_level = VALUES(energy_level),
       stress_level = VALUES(stress_level),
       workload_perception = VALUES(workload_perception),
       feedback_text = VALUES(feedback_text),
       submitted_at = NOW()`,
    [
      randomUUID(),
      data.employee_id,
      data.mood_rating,
      data.energy_level ?? null,
      data.stress_level ?? null,
      data.workload_perception ?? null,
      data.feedback_text ?? null,
      data.week_start_date,
    ]
  );
  queueAutoAwards(data.employee_id, "survey_completed");
}

export async function listPulseChecks(filters: PulseCheckFilters = {}): Promise<PulseCheck[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.employee_id) {
    conditions.push("employee_id = ?");
    params.push(filters.employee_id);
  }
  if (filters.week_start_date) {
    conditions.push("week_start_date = ?");
    params.push(filters.week_start_date);
  }
  if (filters.date_from) {
    conditions.push("submitted_at >= ?");
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    conditions.push("submitted_at <= ?");
    params.push(filters.date_to);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM pulse_check ${where} ORDER BY week_start_date DESC`,
    params
  );
  return rows as PulseCheck[];
}

export async function getPulseSummary(): Promise<RowDataPacket | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as response_count,
            ROUND(AVG(mood_rating), 2) as average_mood,
            ROUND(AVG(energy_level), 2) as average_energy,
            ROUND(AVG(stress_level), 2) as average_stress
       FROM pulse_check
      WHERE week_start_date = DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)`
  );
  return rows[0] ?? null;
}
