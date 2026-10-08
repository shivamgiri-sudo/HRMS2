import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { questionBankService } from "./question-bank.service.js";

export const questionBankRouter = Router();

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;
const h = (handler: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  void handler(req, res).catch(next);
};

function actorId(req: Request) {
  return (req as AuthenticatedRequest).authUser?.id ?? null;
}

function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      message: error.issues[0]?.message ?? "Invalid request",
      code: "VALIDATION_ERROR",
      issues: error.issues,
    });
  }
  const value = error as { statusCode?: number; code?: string; message?: string };
  const status = Number(value?.statusCode ?? 500);
  if (status >= 500) console.error("Question bank route error", error);
  return res.status(Number.isFinite(status) ? status : 500).json({
    success: false,
    message: value?.message ?? "Question bank request failed",
    code: value?.code ?? "QUESTION_BANK_ERROR",
  });
}

const processEnum = z.enum(["inbound", "outbound", "backoffice", "document", "email", "any"]);
const roleEnum = z.enum(["executive", "team_leader", "quality_auditor", "any"]);
const difficultyEnum = z.enum(["basic", "intermediate", "advanced"]);
const questionTypeEnum = z.enum(["single", "multi", "text"]);

const questionSchema = z.object({
  questionCode: z.string().trim().min(1).max(120),
  processKey: processEnum,
  roleKey: roleEnum,
  sectionKey: z.string().trim().min(1).max(100),
  sectionTitle: z.string().trim().min(1).max(255),
  questionType: questionTypeEnum,
  difficultyLevel: difficultyEnum,
  prompt: z.string().trim().min(1).max(5000),
  options: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
  correctAnswer: z.union([z.string(), z.array(z.string())]).optional(),
  keywords: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  explanation: z.string().trim().max(2000).optional(),
  marks: z.coerce.number().min(1).max(100),
  manualReview: z.boolean().optional(),
  setNumber: z.coerce.number().int().min(1).max(1000),
});

const passageSchema = z.object({
  passageCode: z.string().trim().min(1).max(100),
  processKey: processEnum,
  roleKey: roleEnum,
  difficultyLevel: difficultyEnum,
  title: z.string().trim().min(1).max(255),
  passageText: z.string().trim().min(50).max(10000),
  recommendedDurationSeconds: z.coerce.number().int().min(30).max(900).optional(),
  minWpmBenchmark: z.coerce.number().int().min(10).max(150).optional(),
  minAccuracyBenchmark: z.coerce.number().min(50).max(100).optional(),
  setNumber: z.coerce.number().int().min(1).max(1000),
});

const listQuerySchema = z.object({
  process: processEnum.optional(),
  role: roleEnum.optional(),
  section: z.string().trim().max(100).optional(),
  setNumber: z.coerce.number().int().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).max(100000).optional(),
});

const configureRoles = requireRole("admin", "super_admin", "hr", "recruitment_hr");
const readRoles = requireRole("admin", "super_admin", "hr", "recruitment_hr", "recruiter", "manager", "qa");

questionBankRouter.get("/question-bank/stats", readRoles, h(async (_req, res) => {
  try {
    const stats = await questionBankService.countQuestionBankStats();
    return res.json({ success: true, data: stats });
  } catch (error) {
    return sendError(res, error);
  }
}));

questionBankRouter.get("/question-bank/questions", readRoles, h(async (req, res) => {
  try {
    const filters = listQuerySchema.parse(req.query);
    const questions = await questionBankService.listQuestions({
      process: filters.process as "inbound" | "outbound" | "backoffice" | "document" | "email" | "any" | undefined,
      role: filters.role as "executive" | "team_leader" | "quality_auditor" | "any" | undefined,
      section: filters.section,
      setNumber: filters.setNumber,
      limit: filters.limit,
      offset: filters.offset,
    });
    return res.json({ success: true, data: questions });
  } catch (error) {
    return sendError(res, error);
  }
}));

questionBankRouter.get("/question-bank/passages", readRoles, h(async (req, res) => {
  try {
    const filters = listQuerySchema.parse(req.query);
    const passages = await questionBankService.listPassages({
      process: filters.process as "inbound" | "outbound" | "backoffice" | "document" | "email" | "any" | undefined,
      role: filters.role as "executive" | "team_leader" | "quality_auditor" | "any" | undefined,
      setNumber: filters.setNumber,
      limit: filters.limit,
      offset: filters.offset,
    });
    return res.json({ success: true, data: passages });
  } catch (error) {
    return sendError(res, error);
  }
}));

questionBankRouter.post("/question-bank/questions/import", configureRoles, h(async (req, res) => {
  try {
    const body = req.body as { questions?: unknown[] };
    if (!Array.isArray(body.questions)) {
      return res.status(400).json({
        success: false,
        message: "Request body must contain a 'questions' array",
        code: "INVALID_REQUEST",
      });
    }

    const validated = body.questions.map((q, i) => {
      try {
        return questionSchema.parse(q);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw Object.assign(new Error(`Question ${i + 1}: ${error.issues[0]?.message}`), {
            statusCode: 400,
            code: "VALIDATION_ERROR",
          });
        }
        throw error;
      }
    });

    const result = await questionBankService.importQuestions(validated, actorId(req));
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return sendError(res, error);
  }
}));

questionBankRouter.post("/question-bank/passages/import", configureRoles, h(async (req, res) => {
  try {
    const body = req.body as { passages?: unknown[] };
    if (!Array.isArray(body.passages)) {
      return res.status(400).json({
        success: false,
        message: "Request body must contain a 'passages' array",
        code: "INVALID_REQUEST",
      });
    }

    const validated = body.passages.map((p, i) => {
      try {
        return passageSchema.parse(p);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw Object.assign(new Error(`Passage ${i + 1}: ${error.issues[0]?.message}`), {
            statusCode: 400,
            code: "VALIDATION_ERROR",
          });
        }
        throw error;
      }
    });

    const result = await questionBankService.importPassages(validated, actorId(req));
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return sendError(res, error);
  }
}));

questionBankRouter.delete("/question-bank/questions/:code", configureRoles, h(async (req, res) => {
  try {
    const code = z.string().trim().min(1).max(120).parse(req.params.code);
    const deleted = await questionBankService.deleteQuestion(code);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
        code: "QUESTION_NOT_FOUND",
      });
    }
    return res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    return sendError(res, error);
  }
}));

questionBankRouter.delete("/question-bank/passages/:code", configureRoles, h(async (req, res) => {
  try {
    const code = z.string().trim().min(1).max(100).parse(req.params.code);
    const deleted = await questionBankService.deletePassage(code);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Passage not found",
        code: "PASSAGE_NOT_FOUND",
      });
    }
    return res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    return sendError(res, error);
  }
}));
