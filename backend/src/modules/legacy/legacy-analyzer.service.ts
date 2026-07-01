// @ts-nocheck
import { getLegacyPool } from '../../db/legacyDb.js';
import { db as mysqlDb } from '../../db/mysql.js';
import type { ScanResult, TableProfile, RelevanceFactors } from './types.js';
import { randomUUID } from 'crypto';

/**
 * Legacy Database Metadata Analyzer
 * Scans SQL Server db_bill for relevant tables without full table scans
 */
export class LegacyAnalyzerService {
  
  /**
   * Scan legacy database schema for candidate tables
   * Uses INFORMATION_SCHEMA and sys tables (metadata-only, no data scans)
   */
  async scanDatabaseMetadata(): Promise<ScanResult> {
    const startTime = Date.now();
    const pool = await getLegacyPool();
    
    // Query metadata from SQL Server system tables
    const result = await pool.request().query(`
      SELECT 
        s.name AS schema_name,
        t.name AS table_name,
        p.rows AS row_count,
        STATS_DATE(i.object_id, i.index_id) AS last_stats_update,
        t.modify_date AS last_modified
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      INNER JOIN sys.partitions p ON t.object_id = p.object_id
      INNER JOIN sys.indexes i ON t.object_id = i.object_id AND i.index_id < 2
      WHERE t.is_ms_shipped = 0
        AND p.index_id < 2
        AND s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
      ORDER BY p.rows DESC
    `);
    
    const candidateTables: TableProfile[] = [];
    
    for (const row of result.recordset) {
      const factors = await this.analyzeTableRelevance(
        row.schema_name,
        row.table_name,
        row.row_count
      );
      
      const score = this.calculateRelevanceScore(factors);
      
      if (score >= 30) { // Only keep tables with 30+ relevance score
        const profile: TableProfile = {
          id: randomUUID(),
          source_db: 'db_bill',
          schema_name: row.schema_name,
          table_name: row.table_name,
          row_count: row.row_count || 0,
          last_user_update: row.last_modified,
          candidate_latest_column: null,
          max_candidate_date: null,
          relevance_score: score,
          relevance_reason: this.explainScore(factors),
          scan_status: 'pending',
          scanned_at: new Date(),
          created_at: new Date(),
        };
        
        candidateTables.push(profile);
      }
    }
    
    const scanDuration = Date.now() - startTime;
    
    return {
      tablesFound: result.recordset.length,
      candidateTables,
      scanDuration,
    };
  }
  
  /**
   * Analyze table structure for relevance signals
   * Uses INFORMATION_SCHEMA.COLUMNS (metadata-only)
   */
  private async analyzeTableRelevance(
    schema: string,
    table: string,
    rowCount: number
  ): Promise<RelevanceFactors> {
    const pool = await getLegacyPool();
    
    // Get column names (metadata-only)
    const result = await pool.request()
      .input('schema', schema)
      .input('table', table)
      .query(`
        SELECT COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
      `);
    
    const columns = result.recordset.map(r => ({
      name: r.COLUMN_NAME.toLowerCase(),
      type: r.DATA_TYPE.toLowerCase()
    }));
    
    const columnNames = columns.map(c => c.name);
    
    // Relevance signals
    const hasEmployeeColumn = columnNames.some(c => 
      c.includes('emp') || c.includes('employee') || c.includes('staff')
    );
    
    const hasDateColumns = columns.some(c => 
      c.type.includes('date') || c.type.includes('time')
    );
    
    const hasOrgColumns = columnNames.some(c =>
      c.includes('branch') || c.includes('dept') || c.includes('process')
    );
    
    const hasWatermarkColumn = columnNames.some(c =>
      c.includes('modified') || c.includes('updated') || c.includes('created')
    );
    
    const rowCountReasonable = rowCount > 0 && rowCount < 10_000_000;
    
    // Recently updated check would require querying max date - skip for metadata-only approach
    const recentlyUpdated = false; // Conservative default
    
    return {
      hasEmployeeColumn,
      hasDateColumns,
      hasOrgColumns,
      recentlyUpdated,
      hasWatermarkColumn,
      rowCountReasonable,
    };
  }
  
  /**
   * Calculate relevance score (0-100)
   */
  private calculateRelevanceScore(factors: RelevanceFactors): number {
    let score = 0;
    
    if (factors.hasEmployeeColumn) score += 30;
    if (factors.hasDateColumns) score += 15;
    if (factors.hasOrgColumns) score += 15;
    if (factors.recentlyUpdated) score += 20;
    if (factors.hasWatermarkColumn) score += 10;
    if (factors.rowCountReasonable) score += 10;
    
    return score;
  }
  
  /**
   * Generate human-readable explanation
   */
  private explainScore(factors: RelevanceFactors): string {
    const reasons: string[] = [];
    
    if (factors.hasEmployeeColumn) reasons.push('employee-related');
    if (factors.hasDateColumns) reasons.push('has dates');
    if (factors.hasOrgColumns) reasons.push('org-related');
    if (factors.hasWatermarkColumn) reasons.push('has watermark');
    if (factors.rowCountReasonable) reasons.push('reasonable size');
    
    return reasons.join(', ') || 'no strong signals';
  }
  
  /**
   * Store scan results in HRMS database
   */
  async storeScanResults(results: ScanResult): Promise<void> {
    for (const table of results.candidateTables) {
      await mysqlDb.execute(
        `INSERT INTO legacy_source_table_profile 
         (id, source_db, schema_name, table_name, row_count, last_user_update,
          relevance_score, relevance_reason, scan_status, scanned_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          row_count = VALUES(row_count),
          relevance_score = VALUES(relevance_score),
          relevance_reason = VALUES(relevance_reason),
          scanned_at = VALUES(scanned_at)`,
        [
          table.id,
          table.source_db,
          table.schema_name,
          table.table_name,
          table.row_count,
          table.last_user_update,
          table.relevance_score,
          table.relevance_reason,
          table.scan_status,
          table.scanned_at,
          table.created_at,
        ]
      );
    }
  }
  
  /**
   * Get top N candidate tables by relevance score
   */
  async getTopCandidates(limit: number = 20): Promise<TableProfile[]> {
    const [rows] = await mysqlDb.execute<any[]>(
      `SELECT * FROM legacy_source_table_profile
       WHERE relevance_score >= 30
       ORDER BY relevance_score DESC, row_count DESC
       LIMIT ?`,
      [limit]
    );
    
    return rows;
  }
}

export const legacyAnalyzerService = new LegacyAnalyzerService();
