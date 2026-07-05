import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import {
  candidateLogin,
  getCandidateProfile,
  getCandidateTasks,
  getCandidateDocuments,
  uploadCandidateDocument,
  markTaskCompleted,
  verifyToken,
  type CandidateLoginInput,
} from './candidate-portal.service.js';

export const candidatePortalRouter = Router();

interface CandidateAuthRequest extends Request {
  candidateId?: string;
  candidateCode?: string;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

/**
 * Candidate authentication middleware
 */
const candidateAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'No token provided',
    });
  }

  const token = authHeader.substring(7);
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    });
  }

  (req as CandidateAuthRequest).candidateId = decoded.candidate_id;
  (req as CandidateAuthRequest).candidateCode = decoded.candidate_code;
  next();
};

// ── 1. Candidate Login ─────────────────────────────────────────────────────────
candidatePortalRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const input: CandidateLoginInput = {
      candidate_id: req.body.candidate_id,
      password: req.body.password,
    };

    if (!input.candidate_id || !input.password) {
      return res.status(400).json({
        success: false,
        message: 'Candidate ID and password are required',
      });
    }

    const result = await candidateLogin(input);

    if (!result.success) {
      return res.status(401).json(result);
    }

    return res.json(result);
  } catch (error: unknown) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
});

// ── 2. Get Candidate Profile ───────────────────────────────────────────────────
candidatePortalRouter.get('/profile', candidateAuth, async (req: CandidateAuthRequest, res: Response) => {
  try {
    const profile = await getCandidateProfile(req.candidateId!);

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found',
      });
    }

    return res.json({
      success: true,
      data: profile,
    });
  } catch (error: unknown) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
});

// ── 3. Get Onboarding Tasks ────────────────────────────────────────────────────
candidatePortalRouter.get('/tasks', candidateAuth, async (req: CandidateAuthRequest, res: Response) => {
  try {
    const tasks = await getCandidateTasks(req.candidateId!);

    return res.json({
      success: true,
      data: tasks,
    });
  } catch (error: unknown) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
});

// ── 4. Get Uploaded Documents ──────────────────────────────────────────────────
candidatePortalRouter.get('/documents', candidateAuth, async (req: CandidateAuthRequest, res: Response) => {
  try {
    const documents = await getCandidateDocuments(req.candidateId!);

    return res.json({
      success: true,
      data: documents,
    });
  } catch (error: unknown) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
});

// ── 5. Upload Document ─────────────────────────────────────────────────────────
candidatePortalRouter.post('/upload-document', candidateAuth, async (req: CandidateAuthRequest, res: Response) => {
  try {
    const { document_type, file_name, file_url } = req.body;

    if (!document_type || !file_name || !file_url) {
      return res.status(400).json({
        success: false,
        message: 'document_type, file_name, and file_url are required',
      });
    }

    const result = await uploadCandidateDocument(
      req.candidateId!,
      document_type,
      file_name,
      file_url
    );

    return res.json({
      success: true,
      message: 'Document uploaded successfully',
      data: result,
    });
  } catch (error: unknown) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
});

// ── 6. Mark Task as Completed ──────────────────────────────────────────────────
candidatePortalRouter.post('/complete-task', candidateAuth, async (req: CandidateAuthRequest, res: Response) => {
  try {
    const { task_id } = req.body;

    if (!task_id) {
      return res.status(400).json({
        success: false,
        message: 'task_id is required',
      });
    }

    await markTaskCompleted(req.candidateId!, task_id);

    return res.json({
      success: true,
      message: 'Task marked as completed',
    });
  } catch (error: unknown) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
});
