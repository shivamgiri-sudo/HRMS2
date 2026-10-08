import fs from "fs";
import path from "path";
import { PDFParse } from "pdf-parse";

export type AnalysisCheckStatus = "passed" | "warning" | "failed" | "manual_review";

export type JoiningDocumentAnalysisResult = {
  status: AnalysisCheckStatus;
  confidence: number;
  checks: Array<{
    code: string;
    status: AnalysisCheckStatus;
    expected: string;
    found: string;
    remarks: string;
  }>;
  extractedFields: Record<string, string>;
  recommendedAction: "verify" | "pushback" | "reupload" | "manual_review";
};

type AnalysisInput = {
  filePath: string;
  fileRole: string;
  documentCode: string;
  documentName: string;
  templateVersion: string;
  employeeName: string;
  employeeCode: string;
  branchName?: string | null;
  designationName?: string | null;
};

function summarizeStatus(checks: JoiningDocumentAnalysisResult["checks"]): AnalysisCheckStatus {
  if (checks.some((check) => check.status === "failed")) return "failed";
  if (checks.some((check) => check.status === "manual_review")) return "manual_review";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "passed";
}

function recommendedAction(status: AnalysisCheckStatus): JoiningDocumentAnalysisResult["recommendedAction"] {
  switch (status) {
    case "passed":
      return "verify";
    case "warning":
      return "manual_review";
    case "failed":
      return "reupload";
    default:
      return "manual_review";
  }
}

function hasLikelyDate(text: string) {
  return /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(text) || /\b\d{4}-\d{2}-\d{2}\b/.test(text);
}

export async function analyzeEmployeeJoiningDocument(input: AnalysisInput): Promise<JoiningDocumentAnalysisResult> {
  const checks: JoiningDocumentAnalysisResult["checks"] = [];
  const extractedFields: Record<string, string> = {};
  const ext = path.extname(input.filePath).toLowerCase();
  const fileReadable = fs.existsSync(input.filePath);

  checks.push({
    code: "FILE_READABLE",
    status: fileReadable ? "passed" : "failed",
    expected: "Stored file exists and is readable",
    found: fileReadable ? "File present" : "File missing",
    remarks: fileReadable ? "File found on secure storage." : "Secure file could not be located.",
  });

  if (!fileReadable) {
    return {
      status: "failed",
      confidence: 5,
      checks,
      extractedFields,
      recommendedAction: "reupload",
    };
  }

  let rawText = "";
  if (ext === ".pdf") {
    try {
      const parser = new PDFParse({ data: fs.readFileSync(input.filePath) });
      const parsed = await parser.getText();
      rawText = String(parsed.text ?? "");
      await parser.destroy();
    } catch {
      checks.push({
        code: "PDF_PARSE",
        status: "manual_review",
        expected: "PDF content extracted",
        found: "PDF parse failed",
        remarks: "The file is readable but text extraction failed. Manual review is required.",
      });
    }
  } else {
    rawText = path.basename(input.filePath);
  }

  const normalizedText = rawText.toUpperCase();
  const normalizedEmployeeName = input.employeeName.trim().toUpperCase();
  const normalizedEmployeeCode = input.employeeCode.trim().toUpperCase();
  const nameMatch = normalizedText.includes(normalizedEmployeeName);
  const codeMatch = normalizedEmployeeCode ? normalizedText.includes(normalizedEmployeeCode) : false;
  const signedEvidence = input.fileRole === "signed" || /SIGN|ESIGN|DIGITAL SIGNATURE/i.test(rawText);
  const versionMatch = normalizedText.includes(input.templateVersion.toUpperCase()) || input.fileRole === "generated";

  if (nameMatch) extractedFields.employee_name = input.employeeName;
  if (codeMatch) extractedFields.employee_code = input.employeeCode;

  checks.push({
    code: "DOC_TYPE_MATCH",
    status: normalizedText || input.fileRole === "generated" ? "passed" : "warning",
    expected: input.documentName,
    found: rawText ? `${input.documentCode} content present` : "No extractable text",
    remarks: rawText ? "Basic document type heuristics passed." : "Content extraction was limited.",
  });
  checks.push({
    code: "NAME_MATCH",
    status: nameMatch ? "passed" : rawText ? "warning" : "manual_review",
    expected: input.employeeName,
    found: nameMatch ? input.employeeName : "Not detected",
    remarks: nameMatch ? "Employee name matched file content." : "Employee name was not confidently detected.",
  });
  checks.push({
    code: "EMPLOYEE_CODE_MATCH",
    status: input.fileRole === "generated" || codeMatch ? "passed" : "warning",
    expected: input.employeeCode,
    found: codeMatch ? input.employeeCode : "Not detected",
    remarks: codeMatch || input.fileRole === "generated"
      ? "Employee code matched expected value."
      : "Employee code was not found in extracted content.",
  });
  checks.push({
    code: "SIGNATURE_EVIDENCE",
    status: signedEvidence ? "passed" : ["NDA_CONFIDENTIALITY", "EMPLOYMENT_CONTRACT", "EPF_DECLARATION"].includes(input.documentCode) ? "warning" : "passed",
    expected: "Signature or eSign evidence present where applicable",
    found: signedEvidence ? "Detected" : "Not detected",
    remarks: signedEvidence
      ? "Signature/eSign evidence found."
      : "No explicit signature indicator found. Verify manually if this is a signed document.",
  });
  checks.push({
    code: "DATE_PRESENT",
    status: hasLikelyDate(rawText) || input.fileRole === "generated" ? "passed" : "warning",
    expected: "A meaningful date present in document",
    found: hasLikelyDate(rawText) ? "Detected" : "Not detected",
    remarks: hasLikelyDate(rawText) || input.fileRole === "generated"
      ? "Document contains at least one date marker."
      : "No date marker detected in extracted content.",
  });
  checks.push({
    code: "TEMPLATE_VERSION_MATCH",
    status: versionMatch ? "passed" : "warning",
    expected: input.templateVersion,
    found: versionMatch ? input.templateVersion : "Not detected",
    remarks: versionMatch
      ? "Template version appears aligned."
      : "Template version could not be verified from content.",
  });

  const status = summarizeStatus(checks);
  const confidenceBase = 100 - checks.filter((item) => item.status !== "passed").length * 15;

  return {
    status,
    confidence: Math.max(15, confidenceBase),
    checks,
    extractedFields,
    recommendedAction: recommendedAction(status),
  };
}
