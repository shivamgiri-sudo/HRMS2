import { useEffect, useMemo, useRef, useState } from "react";
import { hrmsApi, getAuthToken } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge as SmartHRStatusBadge, normalizeStatus } from "@/components/ui/status-badge";

type UploadTemplate = {
  id: string;
  upload_type_code: string;
  upload_type_name: string;
  target_table: string | null;
  description: string | null;
  required_columns: string[];
  optional_columns: string[];
  sample_row: Record<string, unknown>;
  validation_rules: Record<string, unknown>;
  active_status: boolean;
  created_at: string;
  updated_at: string;
};

type UploadBatch = {
  id: string;
  upload_batch_no: string;
  upload_type_code: string;
  original_file_name: string;
  file_path: string | null;
  file_size_bytes: number | null;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  imported_rows: number;
  batch_status: string;
  uploaded_by: string | null;
  validated_by: string | null;
  imported_by: string | null;
  uploaded_at: string;
  validated_at: string | null;
  imported_at: string | null;
  error_summary: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type UploadBatchRow = {
  id: string;
  upload_batch_id: string;
  row_no: number;
  raw_data: Record<string, unknown>;
  normalized_data: Record<string, unknown>;
  row_status: string;
  error_messages: string[];
  target_record_id: string | null;
  created_at: string;
  updated_at: string;
};

type CsvRow = Record<string, string>;

const BULK_UPLOAD_BUCKET = "hrms-bulk-uploads";

const IMPORT_RPC_BY_TYPE: Record<string, string> = {
  EMPLOYEE_MASTER: "import_upload_batch",
  PROCESS_MASTER: "import_process_upload_batch",
  DEPARTMENT_MASTER: "import_department_upload_batch",
  ASSET_MASTER: "import_asset_upload_batch",
  BRANCH_MASTER: "import_branch_upload_batch",
  LOB_MASTER: "import_lob_upload_batch",
  DESIGNATION_MASTER: "import_designation_upload_batch",
  OFFICIAL_EMAIL_UPDATE: "import_official_email_update_batch",
  REPORTING_MANAGER_UPDATE: "import_reporting_manager_update_batch",
};

function getImportRpc(uploadTypeCode: string) {
  return IMPORT_RPC_BY_TYPE[String(uploadTypeCode || "").toUpperCase()] || "";
}

const statusClass: Record<string, string> = {
  uploaded: "bg-slate-100 text-slate-700 border-slate-200",
  validating: "bg-sky-50 text-sky-700 border-sky-200",
  validated: "bg-emerald-50 text-emerald-700 border-emerald-200",
  validation_failed: "bg-amber-50 text-amber-700 border-amber-200",
  importing: "bg-indigo-50 text-indigo-700 border-indigo-200",
  imported: "bg-emerald-50 text-emerald-700 border-emerald-200",
  imported_with_errors: "bg-amber-50 text-amber-700 border-amber-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

const rowStatusClass: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700 border-slate-200",
  valid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  error: "bg-rose-50 text-rose-700 border-rose-200",
  imported: "bg-indigo-50 text-indigo-700 border-indigo-200",
  skipped: "bg-slate-100 text-slate-500 border-slate-200",
};

function normalizeHeader(value: string) {
  return value.trim().replace(/^\uFEFF/, "");
}

function parseCsv(text: string): CsvRow[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: CsvRow = {};

    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() || "";
    });

    return row;
  });
}

function splitCsvLine(line: string) {
  const result: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === "," && !insideQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function toCsvValue(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadTextFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}


type CsvParseResult = {
  headers: string[];
  rows: CsvRow[];
  rowWidthWarnings: string[];
};

type CsvHealth = {
  headers: string[];
  expectedHeaders: string[];
  missingHeaders: string[];
  unknownHeaders: string[];
  wrongOrder: boolean;
  rowCount: number;
  rowWidthWarnings: string[];
};

function getTemplateHeaders(template: UploadTemplate) {
  const seen = new Set<string>();
  const headers: string[] = [];

  [...(template.required_columns || []), ...(template.optional_columns || [])]
    .map((column) => String(column || "").trim())
    .filter(Boolean)
    .forEach((column) => {
      if (!seen.has(column)) {
        seen.add(column);
        headers.push(column);
      }
    });

  return headers;
}

function parseCsvDetailed(text: string): CsvParseResult {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (lines.length < 1) return { headers: [], rows: [], rowWidthWarnings: [] };

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const rowWidthWarnings: string[] = [];

  const rows = lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line);
    const row: CsvRow = {};

    if (values.length !== headers.length) {
      rowWidthWarnings.push(
        `Row ${index + 1}: expected ${headers.length} column(s), found ${values.length}. Keep blank commas for optional columns and wrap comma values in quotes.`
      );
    }

    headers.forEach((header, headerIndex) => {
      row[header] = values[headerIndex]?.trim() || "";
    });

    return row;
  });

  return { headers, rows, rowWidthWarnings };
}

function buildCsvHealth(
  template: UploadTemplate,
  parsed: CsvParseResult
): CsvHealth {
  const expectedHeaders = getTemplateHeaders(template);
  const uploadedHeaderSet = new Set(parsed.headers);
  const expectedHeaderSet = new Set(expectedHeaders);

  const missingHeaders = expectedHeaders.filter(
    (header) => !uploadedHeaderSet.has(header)
  );
  const unknownHeaders = parsed.headers.filter(
    (header) => header && !expectedHeaderSet.has(header)
  );
  const wrongOrder =
    expectedHeaders.length === parsed.headers.length &&
    expectedHeaders.some((header, index) => header !== parsed.headers[index]);

  return {
    headers: parsed.headers,
    expectedHeaders,
    missingHeaders,
    unknownHeaders,
    wrongOrder,
    rowCount: parsed.rows.length,
    rowWidthWarnings: parsed.rowWidthWarnings,
  };
}

function getFallbackSampleValue(
  uploadTypeCode: string,
  header: string,
  required: boolean
) {
  const normalizedUploadType = uploadTypeCode.toUpperCase();
  const normalizedHeader = header.toLowerCase();

  const employeeSamples: Record<string, string> = {
    employeecode: "TEST001",
    firstname: "Amit",
    lastname: "Kumar",
    email: "amit.test001@example.com",
    designation: "Executive",
    hiredate: "16-05-2026",
    phone: "9876543210",
    department: "Operations",
    managercode: "",
    manageremail: "",
    dateofbirth: "01-01-1995",
    gender: "Male",
    address: "Demo Address",
    city: "Delhi",
    country: "India",
    employmenttype: "full-time",
    status: "active",
    workinghoursstart: "09:00",
    workinghoursend: "18:00",
    workingdays: "1,2,3,4,5",
  };

  const processSamples: Record<string, string> = {
    process_code: "ONF_KYC",
    process_name: "Onfido KYC",
    department_name: "Operations",
    process_type: "BPO",
    branch_name: "Okaya",
    location_name: "Noida",
    active_status: "true",
    description: "KYC backend process",
  };

  const departmentSamples: Record<string, string> = {
    departmentname: "Operations Support",
    "department name": "Operations Support",
    name: "Operations Support",
    description: "Operations support department",
    managercode: "",
    manageremail: "",
  };

  const assetSamples: Record<string, string> = {
    assetcode: "AST001",
    assetname: "Dell Laptop",
    category: "Laptop",
    status: "available",
    serialnumber: "SN-DEMO-001",
    purchasedate: "16-05-2026",
    purchasecost: "45000",
    vendor: "Demo Vendor",
    warrantyenddate: "16-05-2027",
    notes: "Imported from Bulk Upload Hub",
  };

  const branchSamples: Record<string, string> = {
    branchcode: "OKAYA",
    branchname: "Okaya",
    city: "Noida",
    state: "Uttar Pradesh",
    country: "India",
    active: "true",
    activestatus: "true",
    description: "Imported branch master record",
  };

  const lobSamples: Record<string, string> = {
    lobcode: "ONF_KYC",
    lobname: "KYC",
    processcode: "ONF_KYC",
    processname: "Onfido KYC",
    active: "true",
    activestatus: "true",
    description: "Imported LOB master record",
  };

  const designationSamples: Record<string, string> = {
    designationcode: "EXEC",
    designationname: "Executive",
    departmentname: "Operations",
    level: "L1",
    active: "true",
    activestatus: "true",
    description: "Imported designation master record",
  };

  if (normalizedUploadType === "EMPLOYEE_MASTER" && normalizedHeader in employeeSamples) {
    return employeeSamples[normalizedHeader];
  }

  if (normalizedUploadType === "PROCESS_MASTER" && normalizedHeader in processSamples) {
    return processSamples[normalizedHeader];
  }

  if (normalizedUploadType === "DEPARTMENT_MASTER" && normalizedHeader in departmentSamples) {
    return departmentSamples[normalizedHeader];
  }

  if (normalizedUploadType === "ASSET_MASTER" && normalizedHeader in assetSamples) {
    return assetSamples[normalizedHeader];
  }

  if (normalizedUploadType === "BRANCH_MASTER" && normalizedHeader in branchSamples) {
    return branchSamples[normalizedHeader];
  }

  if (normalizedUploadType === "LOB_MASTER" && normalizedHeader in lobSamples) {
    return lobSamples[normalizedHeader];
  }

  if (normalizedUploadType === "DESIGNATION_MASTER" && normalizedHeader in designationSamples) {
    return designationSamples[normalizedHeader];
  }

  const officialEmailSamples: Record<string, string> = {
    employee_code:  "MAS00001",
    official_email: "firstname.lastname@teammas.in",
  };
  if (normalizedUploadType === "OFFICIAL_EMAIL_UPDATE" && normalizedHeader in officialEmailSamples) {
    return officialEmailSamples[normalizedHeader];
  }

  const reportingManagerSamples: Record<string, string> = {
    employee_code: "MAS00001",
    manager_code:  "MAS00100",
  };
  if (normalizedUploadType === "REPORTING_MANAGER_UPDATE" && normalizedHeader in reportingManagerSamples) {
    return reportingManagerSamples[normalizedHeader];
  }

  if (normalizedHeader.includes("date")) return "16-05-2026";
  if (normalizedHeader.includes("email")) return "sample@example.com";
  if (normalizedHeader.includes("phone") || normalizedHeader.includes("mobile")) return "9876543210";
  if (normalizedHeader.includes("status")) return "active";
  if (normalizedHeader.includes("name")) return "Sample Name";
  if (normalizedHeader.includes("code")) return "SAMPLE001";
  if (normalizedHeader.includes("time") || normalizedHeader.includes("start")) return "09:00";
  if (normalizedHeader.includes("end")) return "18:00";
  if (normalizedHeader.includes("days")) return "1,2,3,4,5";
  if (normalizedHeader.includes("amount") || normalizedHeader.includes("salary")) return "10000";
  if (normalizedHeader.includes("count") || normalizedHeader.includes("qty")) return "1";

  return required ? "Sample" : "";
}

function buildTemplateRow(template: UploadTemplate, includeSampleValues: boolean) {
  const sample = template.sample_row || {};
  const required = new Set(template.required_columns || []);
  const uploadTypeCode = String(template.upload_type_code || "").toUpperCase();
  const isEmployeeMaster = uploadTypeCode === "EMPLOYEE_MASTER";
  const isProcessMaster = uploadTypeCode === "PROCESS_MASTER";
  const isDepartmentMaster = uploadTypeCode === "DEPARTMENT_MASTER";
  const isAssetMaster = uploadTypeCode === "ASSET_MASTER";
  const isBranchMaster = uploadTypeCode === "BRANCH_MASTER";
  const isLobMaster = uploadTypeCode === "LOB_MASTER";
  const isDesignationMaster = uploadTypeCode === "DESIGNATION_MASTER";

  return getTemplateHeaders(template).map((header) => {
    if (!includeSampleValues) return "";

    // Core HRMS master imports must always use frontend-safe sample values first.
    // This prevents unsafe database sample values from causing avoidable upload errors when the sample is uploaded directly.
    if (isEmployeeMaster || isProcessMaster || isDepartmentMaster || isAssetMaster || isBranchMaster || isLobMaster || isDesignationMaster) {
      return getFallbackSampleValue(
        template.upload_type_code,
        header,
        required.has(header)
      );
    }

    const dbSampleValue = sample[header];
    const dbSampleText = String(dbSampleValue ?? "").trim();
    if (dbSampleText) return dbSampleText;

    return getFallbackSampleValue(
      template.upload_type_code,
      header,
      required.has(header)
    );
  });
}

function buildTemplateCsv(template: UploadTemplate, includeSampleValues: boolean) {
  const headers = getTemplateHeaders(template);
  const row = buildTemplateRow(template, includeSampleValues);

  return [
    headers.map(toCsvValue).join(","),
    row.map(toCsvValue).join(","),
  ].join("\n");
}

function buildTemplateGuide(template: UploadTemplate) {
  const headers = getTemplateHeaders(template);
  const required = new Set(template.required_columns || []);

  return [
    `Bulk Upload Template Guide - ${template.upload_type_name}`,
    `Upload Type Code: ${template.upload_type_code}`,
    `Target Table: ${template.target_table || "-"}`,
    "",
    "Important rules:",
    "1. Do not rename headers.",
    "2. Do not delete optional columns. Keep blank commas if you do not have a value.",
    "3. Date fields must use DD-MM-YYYY format, for example 16-05-2026.",
    "4. Time fields must use HH:mm format, for example 09:00.",
    "5. Values containing commas must stay inside double quotes, for example \"1,2,3,4,5\".",
    "6. For manager fields, keep ManagerCode and ManagerEmail blank unless the manager already exists in HRMS.",
    "7. For Process Master, Department Name must exactly match an existing HRMS department, for example Operations.",
    "8. For Department Master, keep ManagerCode and ManagerEmail blank unless that manager already exists in Employee Master.",
    "9. For Asset Master, Status should be a valid HRMS asset status such as available, assigned, maintenance, retired, or lost.",
    "10. For Asset Master, PurchaseDate and WarrantyEndDate must use DD-MM-YYYY format.",
    "11. For Branch Master, BranchCode must be unique, for example OKAYA or TPZ.",
    "12. For LOB Master, ProcessCode or ProcessName should match an existing Process Master record.",
    "13. For Designation Master, DepartmentName should exactly match an existing HRMS department, for example Operations.",
    "",
    "Column order:",
    ...headers.map((header, index) => `${index + 1}. ${header}${required.has(header) ? "  [Required]" : "  [Optional]"}`),
  ].join("\n");
}

function csvHealthHasBlockingError(health: CsvHealth | null) {
  if (!health) return false;
  return (
    health.missingHeaders.length > 0 ||
    health.unknownHeaders.length > 0 ||
    health.rowWidthWarnings.length > 0
  );
}

export default function BulkUploadHub() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [templates, setTemplates] = useState<UploadTemplate[]>([]);
  const [batches, setBatches] = useState<UploadBatch[]>([]);
  const [selectedTemplateCode, setSelectedTemplateCode] = useState("");
  const [selectedBatch, setSelectedBatch] = useState<UploadBatch | null>(null);
  const [selectedBatchRows, setSelectedBatchRows] = useState<UploadBatchRow[]>(
    []
  );

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<CsvRow[]>([]);
  const [csvHealth, setCsvHealth] = useState<CsvHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeImportBatchId, setActiveImportBatchId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedTemplate = useMemo(
    () =>
      templates.find(
        (template) => template.upload_type_code === selectedTemplateCode
      ) || null,
    [templates, selectedTemplateCode]
  );

  const stats = useMemo(() => {
    return {
      templates: templates.length,
      batches: batches.length,
      validated: batches.filter((batch) => batch.batch_status === "validated")
        .length,
      imported: batches.filter((batch) =>
        ["imported", "imported_with_errors"].includes(batch.batch_status)
      ).length,
      errors: batches.reduce((total, batch) => total + batch.error_rows, 0),
    };
  }, [templates, batches]);

  async function loadData() {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [templatesResult, batchesResult] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: UploadTemplate[] }>("/api/bulk-upload/templates").catch(() => ({ success: true, data: [] as UploadTemplate[] })),
        hrmsApi.get<{ success: boolean; data: UploadBatch[] }>("/api/bulk-upload/batches").catch(() => ({ success: true, data: [] as UploadBatch[] })),
      ]);

      const loadedTemplates = templatesResult.data || [];
      setTemplates(loadedTemplates);
      setBatches(batchesResult.data || []);

      if (!selectedTemplateCode && loadedTemplates.length > 0) {
        setSelectedTemplateCode(loadedTemplates[0].upload_type_code);
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadBatchRows(batch: UploadBatch) {
    setSelectedBatch(batch);
    setSelectedBatchRows([]);

    try {
      const res = await hrmsApi.get<{ success: boolean; data: UploadBatchRow[] }>(`/api/bulk-upload/batches/${batch.id}/rows`);
      setSelectedBatchRows(res.data || []);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to load batch rows");
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleFileChange(file: File | null) {
    setSelectedFile(file);
    setPreviewRows([]);
    setCsvHealth(null);
    setMessage(null);
    setErrorMessage(null);

    if (!file) return;

    if (file.name.toLowerCase().endsWith(".csv")) {
      const text = await file.text();
      const parsed = parseCsvDetailed(text);
      setPreviewRows(parsed.rows.slice(0, 10));

      if (selectedTemplate) {
        const health = buildCsvHealth(selectedTemplate, parsed);
        setCsvHealth(health);

        if (csvHealthHasBlockingError(health)) {
          setErrorMessage(
            "CSV structure issue found. Download the safe template for this upload type and keep every column in the same order."
          );
        } else if (health.wrongOrder) {
          setMessage(
            "CSV headers are valid, but column order is different from the recommended template. Import can continue, but using the downloaded template is safer."
          );
        }
      }
      return;
    }

    setMessage(
      "Excel file selected. File can be uploaded and tracked. Row preview is available for CSV files only in this handover build. For safest import, download and use the CSV template."
    );
  }

  function downloadTemplate(template: UploadTemplate) {
    const csv = buildTemplateCsv(template, true);

    downloadTextFile(
      `${template.upload_type_code.toLowerCase()}_sample_template.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
  }

  function downloadBlankTemplate(template: UploadTemplate) {
    const csv = buildTemplateCsv(template, false);

    downloadTextFile(
      `${template.upload_type_code.toLowerCase()}_blank_template.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
  }

  function downloadTemplateGuide(template: UploadTemplate) {
    downloadTextFile(
      `${template.upload_type_code.toLowerCase()}_upload_guide.txt`,
      buildTemplateGuide(template),
      "text/plain;charset=utf-8"
    );
  }

  function validateRows(template: UploadTemplate, rows: CsvRow[]) {
    const requiredColumns = template.required_columns || [];
    const allowedColumns = new Set([
      ...(template.required_columns || []),
      ...(template.optional_columns || []),
    ]);

    return rows.map((row, index) => {
      const errors: string[] = [];

      requiredColumns.forEach((column) => {
        const value = row[column];

        if (value === undefined || value === null || String(value).trim() === "") {
          errors.push(`${column} is required`);
        }
      });

      Object.keys(row).forEach((column) => {
        if (column && !allowedColumns.has(column)) {
          errors.push(`Unknown column: ${column}`);
        }
      });

      ["HireDate", "DateOfBirth", "AttendanceDate", "RosterDate", "EffectiveDate", "PayrollMonth"].forEach((column) => {
        const value = String(row[column] || "").trim();
        if (value && !/^\d{2}-\d{2}-\d{4}$/.test(value)) {
          errors.push(`${column} must be DD-MM-YYYY`);
        }
      });

      ["WorkingHoursStart", "WorkingHoursEnd", "ShiftStart", "ShiftEnd"].forEach((column) => {
        const value = String(row[column] || "").trim();
        if (value && !/^\d{2}:\d{2}$/.test(value)) {
          errors.push(`${column} must be HH:mm`);
        }
      });

      return {
        rowNo: index + 1,
        rawData: row,
        normalizedData: row,
        status: errors.length > 0 ? "error" : "valid",
        errors,
      };
    });
  }

  async function createUploadBatch() {
    setMessage(null);
    setErrorMessage(null);

    if (!selectedTemplate) {
      setErrorMessage("Please select an upload template.");
      return;
    }

    if (!selectedFile) {
      setErrorMessage("Please select a CSV or Excel file.");
      return;
    }

    setIsProcessing(true);

    try {
      const batchNo = `BATCH-${Date.now()}`;

      const HRMS_API = import.meta.env.VITE_HRMS_API_URL || "http://localhost:5055";
      const token = getAuthToken();

      // Upload file to local storage
      const formData = new FormData();
      formData.append("file", selectedFile);
      const uploadResponse = await fetch(
        `${HRMS_API}/api/files/upload?category=bulk-uploads`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData }
      );
      if (!uploadResponse.ok) throw new Error("File upload failed");
      const uploadData = await uploadResponse.json();
      const filePath = uploadData.url; // "/api/files/bulk-uploads/uuid.csv"

      let parsedRows: CsvRow[] = [];
      let stagedRows: ReturnType<typeof validateRows> = [];

      if (selectedFile.name.toLowerCase().endsWith(".csv")) {
        const text = await selectedFile.text();
        const parsed = parseCsvDetailed(text);
        const health = buildCsvHealth(selectedTemplate, parsed);
        setCsvHealth(health);

        if (csvHealthHasBlockingError(health)) {
          throw new Error(
            "CSV structure issue found. Please download the safe template for this upload type and keep every column/blank comma position intact."
          );
        }

        parsedRows = parsed.rows;
        stagedRows = validateRows(selectedTemplate, parsedRows);
      }

      const validRows = stagedRows.filter((row) => row.status === "valid").length;
      const errorRows = stagedRows.filter((row) => row.status === "error").length;

      const batchStatus =
        stagedRows.length === 0
          ? "uploaded"
          : errorRows > 0
            ? "validation_failed"
            : "validated";

      const batchRes = await hrmsApi.post<{ data: any }>("/api/bulk-upload/batches", {
        upload_batch_no: batchNo,
        upload_type_code: selectedTemplate.upload_type_code,
        original_file_name: selectedFile.name,
        file_path: filePath,
        file_size_bytes: selectedFile.size,
        total_rows: stagedRows.length,
        valid_rows: validRows,
        error_rows: errorRows,
        batch_status: batchStatus,
        error_summary: errorRows > 0 ? `${errorRows} row(s) have validation errors` : null,
        metadata: {
          source: "frontend_bulk_upload_hub",
          csv_preview_available: selectedFile.name.toLowerCase().endsWith(".csv"),
        },
      });
      const batch = batchRes.data;

      if (stagedRows.length > 0) {
        await hrmsApi.post(`/api/bulk-upload/batches/${batch.id}/rows`,
          stagedRows.map((row) => ({
            row_no: row.rowNo,
            raw_data: row.rawData,
            normalized_data: row.normalizedData,
            row_status: row.status,
            error_messages: row.errors,
          }))
        );
      }

      setMessage("Upload batch created successfully.");
      setSelectedFile(null);
      setPreviewRows([]);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      await loadData();
      await loadBatchRows(batch as UploadBatch);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function importBatchToTarget(batch: UploadBatch) {
    setMessage(null);
    setErrorMessage(null);

    const rpcName = getImportRpc(batch.upload_type_code);
    if (!rpcName) {
      const msg = `Import mapping for ${batch.upload_type_code} is not enabled yet.`;
      setErrorMessage(msg);
      window.alert(msg);
      return;
    }

    if (Number(batch.valid_rows || 0) <= Number(batch.imported_rows || 0)) {
      const msg = "There are no pending valid rows to import for this batch.";
      setErrorMessage(msg);
      window.alert(msg);
      return;
    }

    setIsProcessing(true);
    setActiveImportBatchId(batch.id);
    setMessage(`Import started for ${batch.upload_batch_no}. Please wait...`);

    try {
      const res = await hrmsApi.post<{ success: boolean; data?: any; error?: string }>(`/api/bulk-upload/batches/${batch.id}/import`, {
        rpc_name: rpcName,
      });

      if (!res.success) {
        throw new Error(res.error || "Import action failed.");
      }

      const result = res.data || {};
      if (result.ok === false) {
        throw new Error(result.message || "Import action failed.");
      }

      const importedRows = Number(result.importedRows || result.imported_rows || 0);
      const errorRows = Number(result.errorRows || result.error_rows || 0);
      const successMsg = `Import completed for ${batch.upload_batch_no}. Imported ${importedRows} row(s).${
        errorRows ? ` ${errorRows} row(s) failed and are visible in View Rows.` : ""
      }`;

      setMessage(successMsg);
      window.alert(successMsg);

      await loadData();
      await loadBatchRows(batch);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Import action failed.";
      setErrorMessage(msg);
      window.alert(`Import failed: ${msg}`);
    } finally {
      setIsProcessing(false);
      setActiveImportBatchId(null);
    }
  }

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Admin Operations
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-slate-950">
                  Bulk Upload Hub
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                  Manage upload templates, upload CSV/Excel files, stage rows,
                  validate required columns, and import validated Employee, Process, Department, Asset, Branch, LOB, and Designation master rows directly into HRMS.
                </p>
              </div>

              <button
                onClick={loadData}
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Refresh
              </button>
            </div>
          </section>

          {(message || errorMessage) && (
            <div
              className={`rounded-2xl border p-4 text-sm ${
                errorMessage
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {errorMessage || message}
            </div>
          )}

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Templates" value={stats.templates} />
            <StatCard label="Upload Batches" value={stats.batches} />
            <StatCard label="Validated" value={stats.validated} />
            <StatCard label="Imported" value={stats.imported} />
            <StatCard label="Error Rows" value={stats.errors} />
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-950">
                New Upload
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Choose upload type, download sample template, then upload a CSV
                or Excel file.
              </p>

              <div className="mt-5 space-y-4">
                <Field label="Upload Type">
                  <select
                    value={selectedTemplateCode}
                    onChange={(event) => {
                      setSelectedTemplateCode(event.target.value);
                      setSelectedFile(null);
                      setPreviewRows([]);
                      setCsvHealth(null);
                      setMessage(null);
                      setErrorMessage(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                  >
                    {templates.map((template) => (
                      <option
                        key={template.id}
                        value={template.upload_type_code}
                      >
                        {template.upload_type_name}
                      </option>
                    ))}
                  </select>
                </Field>

                {selectedTemplate && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">
                          {selectedTemplate.upload_type_code}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {selectedTemplate.description || "-"}
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          Target table:{" "}
                          <span className="font-semibold text-slate-800">
                            {selectedTemplate.target_table || "-"}
                          </span>
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => downloadTemplate(selectedTemplate)}
                          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                          Download Sample CSV
                        </button>
                        <button
                          onClick={() => downloadBlankTemplate(selectedTemplate)}
                          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                          Download Blank CSV
                        </button>
                        <button
                          onClick={() => downloadTemplateGuide(selectedTemplate)}
                          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                          Download Guide
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      <ColumnList
                        title="Required Columns"
                        columns={selectedTemplate.required_columns || []}
                      />
                      <ColumnList
                        title="Optional Columns"
                        columns={selectedTemplate.optional_columns || []}
                      />
                    </div>

                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                      <p className="font-semibold">Safe upload rule</p>
                      <p className="mt-1">
                        Always use the downloaded CSV. Do not delete optional columns; keep them blank if not needed. Date format must be DD-MM-YYYY and comma values like WorkingDays must stay inside quotes.
                      </p>
                    </div>
                  </div>
                )}

                <Field label="Upload File">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(event) =>
                      handleFileChange(event.target.files?.[0] || null)
                    }
                    className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-950 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-800"
                  />
                </Field>

                {selectedFile && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                    <p className="font-semibold text-slate-950">
                      Selected File
                    </p>
                    <div className="mt-2 grid gap-2 text-slate-600 sm:grid-cols-3">
                      <span>Name: {selectedFile.name}</span>
                      <span>Size: {formatBytes(selectedFile.size)}</span>
                      <span>Type: {selectedFile.type || "Unknown"}</span>
                    </div>
                  </div>
                )}

                {csvHealth && (
                  <CsvHealthCard health={csvHealth} />
                )}

                {previewRows.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-950">
                      CSV Preview
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Showing first {previewRows.length} row(s). Full staging
                      happens after creating upload batch.
                    </p>

                    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                      <table className="min-w-full divide-y divide-slate-200 text-xs">
                        <thead className="bg-slate-50">
                          <tr>
                            {Object.keys(previewRows[0] || {}).map((key) => (
                              <th
                                key={key}
                                className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-500"
                              >
                                {key}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previewRows.map((row, index) => (
                            <tr key={index}>
                              {Object.keys(previewRows[0] || {}).map((key) => (
                                <td
                                  key={key}
                                  className="whitespace-nowrap px-3 py-2 text-slate-600"
                                >
                                  {row[key] || "-"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={createUploadBatch}
                    disabled={isProcessing || csvHealthHasBlockingError(csvHealth)}
                    className="h-10 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isProcessing ? "Processing..." : "Create Upload Batch"}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-950">
                Upload Templates
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Templates define required columns, optional columns and sample
                format.
              </p>

              <div className="mt-5 max-h-[610px] space-y-3 overflow-y-auto pr-1">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() =>
                      setSelectedTemplateCode(template.upload_type_code)
                    }
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selectedTemplateCode === template.upload_type_code
                        ? "border-slate-950 bg-slate-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">
                          {template.upload_type_name}
                        </p>
                        <p className="mt-1 text-xs font-medium text-slate-400">
                          {template.upload_type_code}
                        </p>
                      </div>

                      <StatusBadge status={template.active_status ? "active" : "inactive"} />
                    </div>

                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                      {template.description || "-"}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">
                  Upload Batch History
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Track uploaded files, validation status, staged rows and import
                  status.
                </p>
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
              {isLoading ? (
                <div className="p-6 text-sm text-slate-500">
                  Loading upload batches...
                </div>
              ) : batches.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No upload batches found.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <Th>Batch No</Th>
                        <Th>Upload Type</Th>
                        <Th>File</Th>
                        <Th>Rows</Th>
                        <Th>Status</Th>
                        <Th>Uploaded</Th>
                        <Th>Actions</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {batches.map((batch) => (
                        <tr key={batch.id} className="hover:bg-slate-50">
                          <Td>
                            <div className="font-semibold text-slate-950">
                              {batch.upload_batch_no}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-400">
                              {batch.id.slice(0, 8)}
                            </div>
                          </Td>
                          <Td>{batch.upload_type_code}</Td>
                          <Td>
                            <div className="max-w-[260px] truncate font-medium text-slate-800">
                              {batch.original_file_name}
                            </div>
                            <div className="text-xs text-slate-400">
                              {formatBytes(batch.file_size_bytes)}
                            </div>
                          </Td>
                          <Td>
                            <div>Total: {batch.total_rows}</div>
                            <div className="text-xs text-slate-400">
                              Valid {batch.valid_rows} / Error{" "}
                              {batch.error_rows} / Imported{" "}
                              {batch.imported_rows}
                            </div>
                          </Td>
                          <Td>
                            <StatusBadge status={batch.batch_status} />
                          </Td>
                          <Td>{formatDateTime(batch.uploaded_at)}</Td>
                          <Td>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => loadBatchRows(batch)}
                                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                View Rows
                              </button>

                              {batch.valid_rows > batch.imported_rows && (
                                <button
                                  onClick={() => importBatchToTarget(batch)}
                                  disabled={isProcessing || activeImportBatchId === batch.id}
                                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {activeImportBatchId === batch.id ? "Importing..." : "Import to HRMS"}
                                </button>
                              )}
                            </div>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>

        {selectedBatch && (
          <BatchRowsDialog
            batch={selectedBatch}
            rows={selectedBatchRows}
            onClose={() => {
              setSelectedBatch(null);
              setSelectedBatchRows([]);
            }}
          />
        )}
      </div>
    </DashboardLayout>
  );
}

function CsvHealthCard({ health }: { health: CsvHealth }) {
  const hasBlockingError = csvHealthHasBlockingError(health);

  return (
    <div
      className={`rounded-2xl border p-4 text-sm ${
        hasBlockingError
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : health.wrongOrder
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold">
            {hasBlockingError
              ? "CSV structure needs correction"
              : health.wrongOrder
                ? "CSV headers are valid, but order is different"
                : "CSV structure looks correct"}
          </p>
          <p className="mt-1 text-xs leading-5 opacity-90">
            Uploaded rows: {health.rowCount}. Expected columns: {health.expectedHeaders.length}. Uploaded columns: {health.headers.length}.
          </p>
        </div>
      </div>

      {(health.missingHeaders.length > 0 || health.unknownHeaders.length > 0) && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {health.missingHeaders.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em]">Missing headers</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {health.missingHeaders.map((header) => (
                  <span key={header} className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-xs font-medium text-rose-700">
                    {header}
                  </span>
                ))}
              </div>
            </div>
          )}
          {health.unknownHeaders.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em]">Unknown headers</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {health.unknownHeaders.map((header) => (
                  <span key={header} className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs font-medium text-amber-700">
                    {header}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {health.rowWidthWarnings.length > 0 && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-rose-700">Row column mismatch</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-rose-700">
            {health.rowWidthWarnings.slice(0, 5).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          {health.rowWidthWarnings.length > 5 && (
            <p className="mt-2 text-xs text-rose-700">+{health.rowWidthWarnings.length - 5} more row(s).</p>
          )}
        </div>
      )}
    </div>
  );
}

function BatchRowsDialog({
  batch,
  rows,
  onClose,
}: {
  batch: UploadBatch;
  rows: UploadBatchRow[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
              Upload Batch Rows
            </p>
            <h3 className="mt-1 text-xl font-semibold text-slate-950">
              {batch.upload_batch_no}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {batch.original_file_name}
            </p>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No staged rows found for this batch.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Row No</Th>
                    <Th>Status</Th>
                    <Th>Raw Data</Th>
                    <Th>Errors</Th>
                    <Th>Created</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <Td>{row.row_no}</Td>
                      <Td>
                        <StatusBadge status={row.row_status} small />
                      </Td>
                      <Td>
                        <pre className="max-w-xl whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-[11px] text-slate-700">
                          {JSON.stringify(row.raw_data, null, 2)}
                        </pre>
                      </Td>
                      <Td>
                        {row.error_messages?.length ? (
                          <ul className="list-disc pl-4 text-rose-600">
                            {row.error_messages.map((error, index) => (
                              <li key={index}>{error}</li>
                            ))}
                          </ul>
                        ) : (
                          "-"
                        )}
                      </Td>
                      <Td>{formatDateTime(row.created_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">
        {label}
      </span>
      {children}
    </label>
  );
}

function ColumnList({
  title,
  columns,
}: {
  title: string;
  columns: string[];
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
        {title}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {columns.length === 0 ? (
          <span className="text-xs text-slate-400">No columns defined.</span>
        ) : (
          columns.map((column) => (
            <span
              key={column}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
            >
              {column}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="whitespace-nowrap px-4 py-3 text-slate-600">{children}</td>;
}

function StatusBadge({
  status,
  small = false,
}: {
  status: string;
  small?: boolean;
}) {
  const label = status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  const statusMap: Record<string, string> = {
    uploaded: "pending",
    validating: "in_progress",
    validated: "success",
    validation_failed: "warning",
    importing: "in_progress",
    imported: "success",
    imported_with_errors: "warning",
    failed: "failed",
    cancelled: "cancelled",
    pending: "pending",
    valid: "success",
    error: "failed",
    skipped: "cancelled",
    active: "success",
    inactive: "cancelled",
  };

  return (
    <SmartHRStatusBadge
      status={normalizeStatus(statusMap[status] || status)}
      label={label}
      className={small ? "text-[11px] px-2 py-0.5" : ""}
    />
  );
}
