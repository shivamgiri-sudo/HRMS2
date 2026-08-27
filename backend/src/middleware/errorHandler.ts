import type { NextFunction, Request, Response } from "express";
import { randomBytes } from "crypto";
import { ZodError } from "zod";

const IS_PROD = process.env.NODE_ENV === "production";

export function notFoundHandler(req: Request, res: Response) {
  return res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error("API Error:", error);

  // multer's own rejections are the uploader's problem to fix, not a server fault.
  // A MulterError carries a `code` (LIMIT_FILE_SIZE, LIMIT_UNEXPECTED_FILE, …) but no
  // `statusCode`, so it used to fall through to the masking branch below and reach the
  // user as "An unexpected server error occurred. Please quote reference <hex>" — a
  // reference number in place of "the file is too large". Nineteen route files upload
  // through multer, so answering it here fixes all of them at once rather than
  // per-route. (A rejection raised inside a route's own `fileFilter` is a plain Error
  // and cannot be told apart from a real fault here — those are still statused at the
  // route, as attendance-apr-bulk.routes.ts does.)
  if (error instanceof Error && error.name === "MulterError") {
    const code = (error as Error & { code?: string }).code;
    const message =
      code === "LIMIT_FILE_SIZE"
        ? "The file is too large for this upload. Reduce its size, or split it and upload the parts separately."
        : code === "LIMIT_UNEXPECTED_FILE"
          ? `The upload sent a file in an unexpected field${
              (error as Error & { field?: string }).field ? ` ("${(error as Error & { field?: string }).field}")` : ""
            }. Attach it in the field this screen expects.`
          : code === "LIMIT_FILE_COUNT"
            ? "Too many files were attached for this upload."
            : error.message || "The uploaded file could not be read.";
    return res.status(400).json({ success: false, errorCode: code ?? null, message });
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: error.flatten().fieldErrors
    });
  }

  if (error instanceof Error) {
    const operationalError = error as Error & { statusCode?: number; code?: string };
    const statusCode = operationalError.statusCode;
    // 4xx errors are operational (bad request, unauthorized, etc.) — safe to surface message
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return res.status(statusCode).json({
        success: false,
        errorCode: operationalError.code ?? null,
        message: error.message
      });
    }
    // An explicit 5xx statusCode means the code chose that status and wrote that
    // message for the candidate — "DigiLocker is temporarily unavailable, upload
    // manually instead", "Live BGV provider is not configured". Masking those was
    // showing candidates "An unexpected server error occurred" for conditions the
    // product already had clear, actionable wording for, and left them with no idea
    // what to do next. Only genuinely unexpected throws (no statusCode) are masked.
    if (statusCode && statusCode >= 500) {
      return res.status(statusCode).json({
        success: false,
        errorCode: operationalError.code ?? null,
        message: error.message
      });
    }
    // Unexpected 500: never leak internals (DB schema, stack traces) in production,
    // but return a reference the candidate can quote so the log line is findable.
    const reference = randomBytes(4).toString("hex");
    console.error(`API Error reference=${reference}`, error);
    return res.status(500).json({
      success: false,
      reference,
      message: IS_PROD
        ? `An unexpected server error occurred. Please quote reference ${reference} if you contact HR.`
        : error.message
    });
  }

  const reference = randomBytes(4).toString("hex");
  console.error(`API Error reference=${reference}`, error);
  return res.status(500).json({
    success: false,
    reference,
    message: IS_PROD
      ? `An unexpected server error occurred. Please quote reference ${reference} if you contact HR.`
      : "Unexpected server error"
  });
}
