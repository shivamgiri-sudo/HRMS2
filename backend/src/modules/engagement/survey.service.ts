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
         (id, survey_id, question_text, question_type, question_order,
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
    "SELECT * FROM survey_question WHERE survey_id = ? ORDER BY question_order",
    [id]
  );
  return { ...(surveyRows[0] as SurveyMaster), questions: questionRows as SurveyQuestion[] };
}

export async function submitSurveyResponse(data: SubmitSurveyResponseDTO): Promise<void> {
  const survey = await getSurvey(data.survey_id);
  if (!survey || !survey.is_active) throw new Error("Survey not found or inactive");

  if (data.employee_id && !survey.is_anonymous) {
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM survey_response WHERE survey_id = ? AND employee_id = ? LIMIT 1",
      [data.survey_id, data.employee_id]
    );
    if (existing.length) throw new Error("Survey already completed");
  }

  const validQuestions = new Set(survey.questions.map((question) => question.id));
  for (const response of data.responses) {
    if (!validQuestions.has(response.question_id)) throw new Error("Invalid survey question");
    await db.execute(
      /*
       * survey_response has one answer column, not three. Its real shape is
       * id, survey_id, question_id, employee_id, response_value, response_date, created_at -
       * there is no response_id, no response_text and no response_choices_json, so this INSERT
       * raised ER_BAD_FIELD_ERROR and no survey response has ever been stored.
       *
       * The three inbound shapes are collapsed onto response_value, which is what the read side
       * already expects (getSurveyResults averages response_value). A scale answer stays a plain
       * number so AVG() keeps working; free text is stored as-is; multiple choice is stored as
       * its JSON array, which is the only lossless option in a single column.
       */
      `INSERT INTO survey_response
         (id, survey_id, question_id, employee_id, response_value)
       VALUES (?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        data.survey_id,
        response.question_id,
        survey.is_anonymous ? null : data.employee_id ?? null,
        response.response_value
          ?? response.response_text
          ?? (response.response_choices_json ? JSON.stringify(response.response_choices_json) : null),
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
            COUNT(sr.id) as response_count,
            AVG(sr.response_value) as average_value
       FROM survey_question sq
       LEFT JOIN survey_response sr ON sr.question_id = sq.id
      WHERE sq.survey_id = ?
      GROUP BY sq.id, sq.question_text, sq.question_type, sq.question_order
      ORDER BY sq.question_order`,
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

/*
 * The answers live in pulse_response, one row per question answered. pulse_check is the question
 * bank - id, pulse_question, pulse_type, response_type, active_status - and this function was
 * inserting an employee's answers straight into it, naming eight columns of which only pulse_id
 * resembles anything real. So every submission raised ER_BAD_FIELD_ERROR and pulse_response is
 * empty: not one pulse check has ever been recorded.
 *
 * Each supplied metric becomes its own pulse_response row against the question of that type. The
 * live question bank has four types - mood (emoji_5), satisfaction (emoji_5), stress (yes_no) and
 * workload (rating_5) - and each is seeded twice, so the question is picked deterministically by
 * id rather than left to whichever row the optimiser returns first; otherwise the same employee's
 * answers could attach to different duplicate questions on different days and never aggregate.
 *
 * energy_level and feedback_text are accepted by the DTO but have nowhere to go: there is no
 * energy pulse type, and no question takes free text - the three response types are emoji_5,
 * yes_no and rating_5. They are deliberately not forced into a rating column, which is the same
 * reason getPulseSummary reports average_energy as NULL. Storing them means adding a question to
 * pulse_check, not bending an existing one.
 *
 * Re-submitting on the same day overwrites rather than stacking, which is what the previous
 * ON DUPLICATE KEY UPDATE intended.
 */
const PULSE_TYPE_BY_FIELD: ReadonlyArray<{ field: keyof SubmitPulseCheckDTO; pulseType: string }> = [
  { field: "mood_rating", pulseType: "mood" },
  { field: "stress_level", pulseType: "stress" },
  { field: "workload_perception", pulseType: "workload" },
];

export async function submitPulseCheck(data: SubmitPulseCheckDTO): Promise<void> {
  const responseDate = data.week_start_date;

  for (const { field, pulseType } of PULSE_TYPE_BY_FIELD) {
    const value = data[field];
    if (value === undefined || value === null) continue;

    const [questionRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM pulse_check
        WHERE pulse_type = ? AND active_status = 1
        ORDER BY id LIMIT 1`,
      [pulseType]
    );
    const pulseId = questionRows[0]?.id;
    if (!pulseId) continue; // no active question of this type; nothing to answer

    await db.execute(
      `DELETE FROM pulse_response
        WHERE pulse_id = ? AND employee_id = ? AND response_date = ?`,
      [pulseId, data.employee_id, responseDate]
    );
    await db.execute(
      `INSERT INTO pulse_response (id, pulse_id, employee_id, response_value, response_date)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), pulseId, data.employee_id, String(value), responseDate]
    );
  }

  queueAutoAwards(data.employee_id, "survey_completed");
}

export async function listPulseChecks(filters: PulseCheckFilters = {}): Promise<PulseCheck[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  /*
   * Same confusion as submitPulseCheck: these filters name employee_id, week_start_date and
   * submitted_at, none of which are columns of pulse_check. Unfiltered the query "worked" and
   * returned the eight question definitions as though they were somebody's answers; filtered it
   * raised ER_BAD_FIELD_ERROR.
   *
   * Reads pulse_response now, joined to its question so the caller still gets the pulse_type it
   * needs to tell one answer from another. week_start_date maps to response_date, which is the
   * date the answer was given.
   */
  if (filters.employee_id) {
    conditions.push("pr.employee_id = ?");
    params.push(filters.employee_id);
  }
  if (filters.week_start_date) {
    conditions.push("pr.response_date = ?");
    params.push(filters.week_start_date);
  }
  if (filters.date_from) {
    conditions.push("pr.response_date >= ?");
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    conditions.push("pr.response_date <= ?");
    params.push(filters.date_to);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT pr.id, pr.pulse_id, pr.employee_id, pr.response_value,
            pr.response_date AS week_start_date, pr.created_at AS submitted_at,
            pc.pulse_type, pc.pulse_question, pc.response_type
       FROM pulse_response pr
       JOIN pulse_check pc ON pc.id = pr.pulse_id
       ${where}
      ORDER BY pr.response_date DESC`,
    params
  );
  return rows as PulseCheck[];
}

export async function getPulseSummary(): Promise<RowDataPacket | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    /*
     * pulse_check is the question definition, not the answers. Its columns are pulse_question,
     * pulse_type, response_type and active_status - it has no mood_rating, energy_level,
     * stress_level or week_start_date, so this raised ER_BAD_FIELD_ERROR and the pulse summary
     * has never returned a figure.
     *
     * The answers are in pulse_response (response_value), and the dimension is pulse_check
     * .pulse_type, whose live values are mood, workload, satisfaction and stress. So mood and
     * stress are averaged by pivoting on that type.
     *
     * average_energy is NULL because there is no energy pulse type. Mapping it onto workload or
     * satisfaction would put a number under a label that does not describe it; null renders as
     * "not measured", which is what it is.
     */
    `SELECT COUNT(*) as response_count,
            ROUND(AVG(CASE WHEN pc.pulse_type = 'mood'   THEN CAST(pr.response_value AS DECIMAL(10,2)) END), 2) as average_mood,
            NULL as average_energy,
            ROUND(AVG(CASE WHEN pc.pulse_type = 'stress' THEN CAST(pr.response_value AS DECIMAL(10,2)) END), 2) as average_stress
       FROM pulse_response pr
       JOIN pulse_check pc ON pc.id = pr.pulse_id
      WHERE pr.response_date >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)`
  );
  return rows[0] ?? null;
}
