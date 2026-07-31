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
