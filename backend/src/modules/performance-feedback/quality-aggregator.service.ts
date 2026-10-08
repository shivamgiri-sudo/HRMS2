/**
 * Quality Data Aggregator Service
 *
 * Aggregates quality data from multiple sources:
 * 1. Database (Shivamgiri, db_audit) - Direct SQL
 * 2. Google Sheets - via Google Sheets API
 * 3. Excel files - via uploaded files or file system
 *
 * Provides unified quality metrics regardless of data source.
 */

import { getEmployeeQualityMetrics as getDbQuality } from './quality-data.service.js';

interface QualitySource {
  source_type: 'database' | 'google_sheet' | 'excel';
  source_id: string;
  process_name: string;
  is_active: boolean;
  config: any;
}

interface AggregatedQualityData {
  employee_code: string;
  process_name?: string;
  total_calls: number;
  audited_calls: number;
  avg_quality_score: number;
  quality_band: string;
  data_source: string;
  last_updated: string;
}

/**
 * Fetch quality data from Google Sheets
 * Requires Google Sheets API credentials
 */
async function fetchGoogleSheetQuality(
  sheetId: string,
  employeeCode: string,
  startDate: string,
  endDate: string
): Promise<AggregatedQualityData | null> {
  // TODO: Implement Google Sheets API integration
  // For now, return placeholder
  return null;
}

/**
 * Fetch quality data from Excel file
 * File should be pre-uploaded to a known location
 */
async function fetchExcelQuality(
  filePath: string,
  employeeCode: string,
  startDate: string,
  endDate: string
): Promise<AggregatedQualityData | null> {
  // TODO: Implement Excel file parsing with xlsx library
  // For now, return placeholder
  return null;
}

/**
 * Get quality data from all configured sources
 * Aggregates and merges data from database, Google Sheets, and Excel
 */
export async function getAggregatedQualityData(
  employeeCode: string,
  startDate: string,
  endDate: string,
  processFilter?: string
): Promise<AggregatedQualityData[]> {
  const results: AggregatedQualityData[] = [];

  // 1. Fetch from database (primary source)
  try {
    const dbData = await getDbQuality(employeeCode, startDate, endDate);
    if (dbData) {
      results.push({
        employee_code: dbData.employee_code,
        process_name: 'All Processes (Database)',
        total_calls: dbData.total_calls,
        audited_calls: dbData.audited_calls,
        avg_quality_score: dbData.avg_quality_score,
        quality_band: dbData.quality_band,
        data_source: 'database',
        last_updated: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error fetching database quality:', error);
  }

  // 2. Fetch from Google Sheets (if configured)
  // Query integration_config for Google Sheets sources
  try {
    // const sheetSources = await getQualitySources('google_sheet');
    // for (const source of sheetSources) {
    //   const sheetData = await fetchGoogleSheetQuality(
    //     source.source_id,
    //     employeeCode,
    //     startDate,
    //     endDate
    //   );
    //   if (sheetData) results.push(sheetData);
    // }
  } catch (error) {
    console.error('Error fetching Google Sheets quality:', error);
  }

  // 3. Fetch from Excel files (if configured)
  try {
    // const excelSources = await getQualitySources('excel');
    // for (const source of excelSources) {
    //   const excelData = await fetchExcelQuality(
    //     source.source_id,
    //     employeeCode,
    //     startDate,
    //     endDate
    //   );
    //   if (excelData) results.push(excelData);
    // }
  } catch (error) {
    console.error('Error fetching Excel quality:', error);
  }

  // Filter by process if specified
  if (processFilter) {
    return results.filter(r =>
      r.process_name?.toLowerCase().includes(processFilter.toLowerCase())
    );
  }

  return results;
}

/**
 * Upload CSV file and parse quality data
 * Returns parsed records ready for storage
 * Note: xlsx package not installed — CSV-only. Excel users: File → Save As → CSV.
 */
export async function uploadExcelQualityData(
  file: Express.Multer.File,
  processName: string
): Promise<{ success: boolean; records: number; message: string }> {
  try {
    // Support CSV files (no library needed) — Excel users can Save As CSV
    const content = file.buffer.toString('utf-8');
    const ext = (file.originalname || '').toLowerCase();

    if (!ext.endsWith('.csv')) {
      return {
        success: false,
        records: 0,
        message: 'Only CSV files are supported for bulk upload. In Excel, use File → Save As → CSV.'
      };
    }

    const lines = content.split('\n').map((l: string) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      return { success: false, records: 0, message: 'File is empty or has no data rows.' };
    }

    const headers = lines[0].split(',').map((h: string) => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
    const records: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v: string) => v.trim().replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((h: string, idx: number) => { row[h] = values[idx] ?? ''; });
      if (row.employee_code || row.emp_code || row.employeecode) {
        records.push(row);
      }
    }

    return {
      success: true,
      records: records.length,
      message: `Parsed ${records.length} records from CSV. Data preview available. Use Integration Hub to commit to database.`
    };
  } catch (error: any) {
    return { success: false, records: 0, message: error.message || 'Failed to parse file' };
  }
}

/**
 * Connect to Google Sheet and validate structure
 * Returns preview of data
 * Note: googleapis package not installed — directs user to Integration Hub instead.
 */
export async function connectGoogleSheet(
  sheetId: string,
  _sheetName: string,
  _credentialsJson: string
): Promise<{ success: boolean; preview: any[]; message: string }> {
  if (!sheetId) {
    return { success: false, preview: [], message: 'Sheet ID is required.' };
  }
  // Google Sheets API requires googleapis package which is not installed.
  // Direct the user to use Integration Hub → External DB connector instead.
  return {
    success: false,
    preview: [],
    message: 'Google Sheets direct integration requires the googleapis package. Use Integration Hub → External Connector to map your Google Sheet data, or export the sheet as CSV and use the CSV upload feature.'
  };
}

/**
 * Sync quality data from configured source
 * Reads from source and stores in mas_hrms for unified access
 * Note: google_sheet requires googleapis (not installed); excel requires CSV upload path.
 */
export async function syncQualityDataFromSource(
  sourceType: 'google_sheet' | 'excel',
  sourceId: string,
  processName: string
): Promise<{ success: boolean; records_synced: number; errors: number }> {
  if (sourceType === 'google_sheet') {
    console.warn('[quality-aggregator] Google Sheets sync not available — googleapis package not installed. Use Integration Hub.');
    return { success: false, records_synced: 0, errors: 1 };
  }

  if (sourceType === 'excel') {
    console.warn('[quality-aggregator] Direct Excel sync not supported. Use CSV upload via uploadExcelQualityData().');
    return { success: false, records_synced: 0, errors: 1 };
  }

  return { success: false, records_synced: 0, errors: 1 };
}
