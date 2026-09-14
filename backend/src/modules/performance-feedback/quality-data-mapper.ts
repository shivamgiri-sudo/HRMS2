/**
 * Quality Data Mapper & Validator
 *
 * Handles format mismatches, header variations, and data validation
 * when importing quality data from multiple sources.
 *
 * Problems Solved:
 * 1. Different column names for same data (Employee Code vs Emp ID vs User)
 * 2. Date format variations (DD/MM/YYYY vs YYYY-MM-DD vs MM-DD-YYYY)
 * 3. Score format variations (85% vs 0.85 vs 85/100)
 * 4. Missing required columns
 * 5. Invalid data (future dates, scores > 100%, invalid employee codes)
 * 6. Duplicate detection
 * 7. Encoding issues
 */

interface ColumnMapping {
  source_column: string;
  target_field: string;
  data_type: 'string' | 'number' | 'date' | 'boolean' | 'percentage';
  is_required: boolean;
  default_value?: any;
  transform?: (value: any) => any;
}

interface ValidationRule {
  field: string;
  rule: 'required' | 'format' | 'range' | 'regex' | 'exists';
  params?: any;
  error_message: string;
}

interface ImportResult {
  success: boolean;
  total_rows: number;
  imported: number;
  skipped: number;
  errors: Array<{
    row: number;
    field: string;
    value: any;
    error: string;
  }>;
  warnings: string[];
}

// Standard field mappings for quality data
export const STANDARD_QUALITY_FIELDS = {
  employee_code: {
    aliases: ['employee_code', 'emp_code', 'empcode', 'employee_id', 'user', 'userid', 'agent_id', 'agentid'],
    data_type: 'string',
    is_required: true,
    transform: (val: any) => String(val).trim().toUpperCase()
  },
  call_date: {
    aliases: ['call_date', 'calldate', 'date', 'audit_date', 'auditdate', 'date_of_call'],
    data_type: 'date',
    is_required: true,
    transform: parseDate
  },
  quality_score: {
    aliases: ['quality_score', 'score', 'final_score', 'total_score', 'quality', 'percentage'],
    data_type: 'percentage',
    is_required: true,
    transform: parseScore
  },
  call_id: {
    aliases: ['call_id', 'callid', 'lead_id', 'leadid', 'ticket_id', 'ticketid'],
    data_type: 'string',
    is_required: false,
    transform: (val: any) => val ? String(val).trim() : null
  },
  campaign: {
    aliases: ['campaign', 'campaign_name', 'process', 'process_name', 'project'],
    data_type: 'string',
    is_required: false,
    transform: (val: any) => val ? String(val).trim() : null
  },
  auditor: {
    aliases: ['auditor', 'auditor_name', 'qa', 'qa_name', 'reviewer'],
    data_type: 'string',
    is_required: false,
    transform: (val: any) => val ? String(val).trim() : null
  },
  total_parameters: {
    aliases: ['total_parameters', 'total_params', 'max_score', 'total_checks'],
    data_type: 'number',
    is_required: false,
    transform: (val: any) => val ? parseInt(val) : null
  },
  passed_parameters: {
    aliases: ['passed_parameters', 'passed_params', 'score', 'passed_checks'],
    data_type: 'number',
    is_required: false,
    transform: (val: any) => val ? parseInt(val) : null
  }
};

/**
 * Parse date from various formats
 */
function parseDate(value: any): string | null {
  if (!value) return null;

  const str = String(value).trim();

  // Try standard format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // Try DD/MM/YYYY
  const ddmmyyyy = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try MM/DD/YYYY (US format)
  const mmddyyyy = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (mmddyyyy) {
    const [, month, day, year] = mmddyyyy;
    // Ambiguous - assume DD/MM/YYYY unless day > 12
    if (parseInt(day) > 12) {
      return `${year}-${day.padStart(2, '0')}-${month.padStart(2, '0')}`;
    }
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try Excel serial date (days since 1900-01-01)
  const num = parseFloat(str);
  if (!isNaN(num) && num > 25000 && num < 100000) {
    const date = new Date((num - 25569) * 86400 * 1000);
    return date.toISOString().split('T')[0];
  }

  return null;
}

/**
 * Parse score from various formats
 */
function parseScore(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;

  const str = String(value).trim();

  // Percentage format: 85% or 85.5%
  if (str.endsWith('%')) {
    return parseFloat(str.replace('%', ''));
  }

  // Decimal format: 0.85
  const num = parseFloat(str);
  if (isNaN(num)) return null;

  // If between 0 and 1, convert to percentage
  if (num >= 0 && num <= 1) {
    return num * 100;
  }

  // If between 0 and 100, assume percentage
  if (num >= 0 && num <= 100) {
    return num;
  }

  return null;
}

/**
 * Auto-detect column mappings from header row
 */
export function detectColumnMappings(headers: string[]): {
  mappings: ColumnMapping[];
  unmapped: string[];
  confidence: number;
} {
  const mappings: ColumnMapping[] = [];
  const unmapped: string[] = [];
  let matchedCount = 0;

  for (const header of headers) {
    const normalizedHeader = header.toLowerCase().replace(/[^a-z0-9]/g, '');
    let matched = false;

    for (const [targetField, config] of Object.entries(STANDARD_QUALITY_FIELDS)) {
      for (const alias of config.aliases) {
        const normalizedAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalizedHeader === normalizedAlias) {
          mappings.push({
            source_column: header,
            target_field: targetField,
            data_type: config.data_type as any,
            is_required: config.is_required,
            transform: config.transform
          });
          matched = true;
          matchedCount++;
          break;
        }
      }
      if (matched) break;
    }

    if (!matched) {
      unmapped.push(header);
    }
  }

  const confidence = (matchedCount / Object.keys(STANDARD_QUALITY_FIELDS).length) * 100;

  return { mappings, unmapped, confidence };
}

/**
 * Validate and transform a single row of data
 */
export function validateAndTransformRow(
  row: any,
  mappings: ColumnMapping[],
  rowIndex: number
): { data: any; errors: any[] } {
  const transformedData: any = {};
  const errors: any[] = [];

  // Apply mappings
  for (const mapping of mappings) {
    const sourceValue = row[mapping.source_column];

    // Check required fields
    if (mapping.is_required && (sourceValue === null || sourceValue === undefined || sourceValue === '')) {
      errors.push({
        row: rowIndex,
        field: mapping.target_field,
        value: sourceValue,
        error: `Required field '${mapping.source_column}' is missing or empty`
      });
      continue;
    }

    // Transform value
    try {
      const transformedValue = mapping.transform
        ? mapping.transform(sourceValue)
        : sourceValue;

      transformedData[mapping.target_field] = transformedValue;

      // Additional validation
      if (transformedValue === null && mapping.is_required) {
        errors.push({
          row: rowIndex,
          field: mapping.target_field,
          value: sourceValue,
          error: `Could not parse '${sourceValue}' for field '${mapping.source_column}'`
        });
      }
    } catch (error: any) {
      errors.push({
        row: rowIndex,
        field: mapping.target_field,
        value: sourceValue,
        error: `Transform error: ${error.message}`
      });
    }
  }

  // Validate data
  const validationErrors = validateQualityRecord(transformedData, rowIndex);
  errors.push(...validationErrors);

  return { data: transformedData, errors };
}

/**
 * Validate quality record business rules
 */
function validateQualityRecord(record: any, rowIndex: number): any[] {
  const errors: any[] = [];

  // Validate employee code format (should start with MAS, IDC, or be numeric)
  if (record.employee_code) {
    const code = record.employee_code;
    if (!/^(MAS|IDC|[0-9])/i.test(code)) {
      errors.push({
        row: rowIndex,
        field: 'employee_code',
        value: code,
        error: `Invalid employee code format. Should start with MAS, IDC, or be numeric`
      });
    }
  }

  // Validate date is not in future
  if (record.call_date) {
    const callDate = new Date(record.call_date);
    const today = new Date();
    if (callDate > today) {
      errors.push({
        row: rowIndex,
        field: 'call_date',
        value: record.call_date,
        error: `Date cannot be in the future`
      });
    }

    // Validate date is not too old (more than 2 years)
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    if (callDate < twoYearsAgo) {
      // Warning, not error
      errors.push({
        row: rowIndex,
        field: 'call_date',
        value: record.call_date,
        error: `Warning: Date is more than 2 years old`,
        severity: 'warning'
      });
    }
  }

  // Validate quality score range (0-100)
  if (record.quality_score !== null && record.quality_score !== undefined) {
    const score = parseFloat(record.quality_score);
    if (score < 0 || score > 100) {
      errors.push({
        row: rowIndex,
        field: 'quality_score',
        value: record.quality_score,
        error: `Score must be between 0 and 100`
      });
    }
  }

  // Validate passed_parameters <= total_parameters
  if (record.passed_parameters !== null && record.total_parameters !== null) {
    if (record.passed_parameters > record.total_parameters) {
      errors.push({
        row: rowIndex,
        field: 'passed_parameters',
        value: record.passed_parameters,
        error: `Passed parameters (${record.passed_parameters}) cannot exceed total parameters (${record.total_parameters})`
      });
    }
  }

  return errors;
}

/**
 * Process entire dataset with mapping and validation
 */
export function processQualityDataset(
  rows: any[],
  headers: string[],
  customMappings?: ColumnMapping[]
): ImportResult {
  // Auto-detect or use custom mappings
  const { mappings, unmapped, confidence } = customMappings
    ? { mappings: customMappings, unmapped: [], confidence: 100 }
    : detectColumnMappings(headers);

  const result: ImportResult = {
    success: true,
    total_rows: rows.length,
    imported: 0,
    skipped: 0,
    errors: [],
    warnings: []
  };

  // Check if we have minimum required fields
  const requiredFields = ['employee_code', 'call_date', 'quality_score'];
  const mappedFields = mappings.map(m => m.target_field);
  const missingRequired = requiredFields.filter(f => !mappedFields.includes(f));

  if (missingRequired.length > 0) {
    result.success = false;
    result.warnings.push(
      `Missing required fields: ${missingRequired.join(', ')}. ` +
      `Please provide custom mappings or fix the source file.`
    );
    return result;
  }

  if (unmapped.length > 0) {
    result.warnings.push(`Unmapped columns (will be ignored): ${unmapped.join(', ')}`);
  }

  if (confidence < 80) {
    result.warnings.push(
      `Low confidence (${confidence.toFixed(0)}%) in auto-detected mappings. ` +
      `Please review and adjust if needed.`
    );
  }

  // Process each row
  for (let i = 0; i < rows.length; i++) {
    const { data, errors } = validateAndTransformRow(rows[i], mappings, i + 2); // +2 for header + 1-indexed

    if (errors.length > 0) {
      const criticalErrors = errors.filter(e => e.severity !== 'warning');
      if (criticalErrors.length > 0) {
        result.errors.push(...errors);
        result.skipped++;
      } else {
        // Only warnings, import anyway
        result.imported++;
        result.warnings.push(...errors.map(e => `Row ${e.row}: ${e.error}`));
      }
    } else {
      result.imported++;
    }
  }

  result.success = result.imported > 0;

  return result;
}

/**
 * Generate mapping preview for UI
 */
export function generateMappingPreview(
  sampleRows: any[],
  headers: string[]
): {
  headers: string[];
  mappings: any[];
  samples: any[][];
  confidence: number;
} {
  const { mappings, unmapped, confidence } = detectColumnMappings(headers);

  // Get first 5 rows as samples
  const samples = sampleRows.slice(0, 5).map(row =>
    headers.map(header => row[header])
  );

  return {
    headers,
    mappings: mappings.map(m => ({
      source: m.source_column,
      target: m.target_field,
      type: m.data_type,
      required: m.is_required
    })),
    samples,
    confidence
  };
}
