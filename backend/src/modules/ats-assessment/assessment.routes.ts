import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { candidateAssessmentPage } from './assessment.page.js';
import { assessmentService } from './assessment.service.js';

export const assessmentPublicRouter = Router();
export const assessmentProtectedRouter = Router();

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

const publicLimiter = rateLimit({
  windowMs: 60_000,
  limit: 90,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many assessment requests. Please wait a moment and try again.' },
});

function meta(req: Request) {
  return {
    ip: req.ip ?? req.socket.remoteAddress ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

function responseError(res: Response, error: unknown) {
  const value = error as { statusCode?: number; code?: string; message?: string };
  const status = Number(value?.statusCode ?? 500);
  return res.status(Number.isFinite(status) ? status : 500).json({
    success: false,
    message: value?.message ?? 'Assessment request failed',
    code: value?.code ?? undefined,
  });
}

assessmentPublicRouter.use('/assessment', publicLimiter);

assessmentPublicRouter.get('/assessment', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'");
  return res.type('html').send(candidateAssessmentPage());
});

assessmentPublicRouter.get('/assessment/health', h(async (_req, res) => {
  try {
    await assessmentService.ensureAssessmentSchema();
    return res.json({ success: true, data: { status: 'ok', oneAssessmentAttempt: true, maxTypingAttempts: 2 } });
  } catch (error) {
    return responseError(res, error);
  }
}));

assessmentPublicRouter.post('/assessment/lookup', h(async (req, res) => {
  try {
    const data = await assessmentService.lookupOrAssignAssessment({
      queueToken: String(req.body?.queueToken ?? ''),
      mobile: String(req.body?.mobile ?? ''),
      process: req.body?.process ? String(req.body.process) : null,
      role: req.body?.role ? String(req.body.role) : null,
      meta: meta(req),
    });
    return res.json({ success: true, data });
  } catch (error) {
    return responseError(res, error);
  }
}));

assessmentPublicRouter.get('/assessment/session/:token', h(async (req, res) => {
  try {
    const data = await assessmentService.getAssessmentSession(req.params.token);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, data });
  } catch (error) {
    return responseError(res, error);
  }
}));

assessmentPublicRouter.post('/assessment/session/:token/start', h(async (req, res) => {
  try {
    const data = await assessmentService.startAssessment(req.params.token, meta(req));
    return res.json({ success: true, data });
  } catch (error) {
    return responseError(res, error);
  }
}));

assessmentPublicRouter.put('/assessment/session/:token/responses/:questionId', h(async (req, res) => {
  try {
    const data = await assessmentService.saveResponse(
      req.params.token,
      req.params.questionId,
      req.body?.answer,
      req.body?.timeTakenSeconds == null ? undefined : Number(req.body.timeTakenSeconds),
    );
    return res.json({ success: true, data });
  } catch (error) {
    return responseError(res, error);
  }
}));

assessmentPublicRouter.post('/assessment/session/:token/integrity', h(async (req, res) => {
  try {
    const data = await assessmentService.recordIntegrityEvent(
      req.params.token,
      String(req.body?.eventType ?? 'unknown').slice(0, 80),
      req.body?.details ?? {},
      meta(req),
    );
    return res.json({ success: true, data });
  } catch (error) {
    return responseError(res, error);
  }
}));

assessmentPublicRouter.post('/assessment/session/:token/typing/start', h(async (req, res) => {
  try {
    const data = await assessmentService.startTypingAttempt(req.params.token, meta(req));
    return res.json({ success: true, data });
  } catch (error) {
    return responseError(res, error);
  }
}));

assessmentPublicRouter.post('/assessment/session/:token/typing/:typingAttemptId/submit', h(async (req, res) => {
  try {
    const data = await assessmentService.submitTypingAttempt(
      req.params.token,
      req.params.typingAttemptId,
      {
        typedText: String(req.body?.typedText ?? ''),
        backspaceCount: Number(req.body?.backspaceCount ?? 0),
        pasteAttempts: Number(req.body?.pasteAttempts ?? 0),
      },
      meta(req),
    );
    return res.json({ success: true, data });
  } catch (error) {
    return responseError(res, error);
  }
}));

assessmentPublicRouter.post('/assessment/session/:token/submit', h(async (req, res) => {
  try {
    const data = await assessmentService.submitAssessment(req.params.token, meta(req));
    return res.json({ success: true, data });
  } catch (error) {
    return responseError(res, error);
  }
}));

assessmentPublicRouter.get('/assessment/session/:token/result', h(async (req, res) => {
  try {
    const data = await assessmentService.getAssessmentResult(req.params.token);
    return res.json({ success: true, data });
  } catch (error) {
    return responseError(res, error);
  }
}));

assessmentProtectedRouter.get(
  '/assessment-admin/candidates/:candidateId/summary',
  requireRole('admin', 'super_admin', 'hr', 'recruiter', 'manager'),
  h(async (req, res) => {
    try {
      const data = await assessmentService.getCandidateAssessmentSummary(req.params.candidateId);
      return res.json({ success: true, data });
    } catch (error) {
      return responseError(res, error);
    }
  }),
);

assessmentProtectedRouter.get(
  '/assessment-admin/attempts',
  requireRole('admin', 'super_admin', 'hr', 'recruiter', 'manager'),
  h(async (req, res) => {
    try {
      const data = await assessmentService.listAssessmentAttempts({
        status: req.query.status ? String(req.query.status) : undefined,
        process: req.query.process ? String(req.query.process) : undefined,
        role: req.query.role ? String(req.query.role) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      return res.json({ success: true, data });
    } catch (error) {
      return responseError(res, error);
    }
  }),
);

assessmentProtectedRouter.post(
  '/assessment-admin/templates/sync-defaults',
  requireRole('admin', 'super_admin', 'hr'),
  h(async (_req: AuthenticatedRequest, res) => {
    try {
      await assessmentService.ensureAssessmentSchema();
      const data = await assessmentService.syncDefaultTemplates();
      return res.json({ success: true, data });
    } catch (error) {
      return responseError(res, error);
    }
  }),
);
