import { getLegacyPool, testLegacyConnection } from '../../db/legacyDb.js';
import { db as mysqlDb } from '../../db/mysql.js';
import { env } from '../../config/env.js';
import { legacyAnalyzerService } from './legacy-analyzer.service.js';
import type { SyncMap, MappingCandidate } from './types.js';

/**
 * Legacy Sync Business Logic Service
 */
export class LegacyService {
  
  /**
   * Health check for legacy database connection
   */
  async checkHealth(): Promise<{ ok: boolean; message: string; details?: any }> {
    if (!env.LEGACY_SYNC_ENABLED) {
      return {
        ok: false,
        message: 'Legacy sync is disabled (LEGACY_SYNC_ENABLED=false)',
      };
    }
    
    const connTest = await testLegacyConnection();
    
    if (!connTest.ok) {
      return {
        ok: false,
        message: `Legacy DB connection failed: ${connTest.error}`,
      };
    }
    
    return {
      ok: true,
      message: 'Legacy database connection healthy',
      details: {
        host: env.LEGACY_MSSQL_HOST,
        database: env.LEGACY_MSSQL_DATABASE,
        syncEnabled: env.LEGACY_SYNC_ENABLED,
        intervalMs: env.LEGACY_SYNC_INTERVAL_MS,
      },
    };
  }
  
  /**
   * Get connection information (safe for display)
   */
  getConnectionInfo(): any {
    return {
      host: env.LEGACY_MSSQL_HOST,
      port: env.LEGACY_MSSQL_PORT,
      database: env.LEGACY_MSSQL_DATABASE,
      user: env.LEGACY_MSSQL_USER,
      syncEnabled: env.LEGACY_SYNC_ENABLED,
      intervalMs: env.LEGACY_SYNC_INTERVAL_MS,
      batchSize: env.LEGACY_SYNC_BATCH_SIZE,
      parallelDomains: env.LEGACY_SYNC_PARALLEL_DOMAINS,
    };
  }
  
  /**
   * Run schema analysis and return top candidates
   */
  async analyzeSchema(): Promise<{ candidateCount: number; topCandidates: any[] }> {
    // Scan legacy database
    const scanResult = await legacyAnalyzerService.scanDatabaseMetadata();
    
    // Store results
    await legacyAnalyzerService.storeScanResults(scanResult);
    
    // Get top candidates
    const topCandidates = await legacyAnalyzerService.getTopCandidates(20);
    
    return {
      candidateCount: scanResult.candidateTables.length,
      topCandidates,
    };
  }
  
  /**
   * Get all mapping candidates (pending approval)
   */
  async getMappingCandidates(): Promise<MappingCandidate[]> {
    const [rows] = await mysqlDb.execute<any[]>(
      `SELECT * FROM legacy_mapping_candidates
       WHERE approved_status = 'pending'
       ORDER BY confidence_score DESC, created_at DESC
       LIMIT 100`
    );
    
    return rows;
  }
  
  /**
   * Approve a mapping candidate
   */
  async approveMappingCandidate(id: string, userId: string): Promise<void> {
    await mysqlDb.execute(
      `UPDATE legacy_mapping_candidates
       SET approved_status = 'approved', approved_by = ?, approved_at = NOW()
       WHERE id = ?`,
      [userId, id]
    );
  }
  
  /**
   * Reject a mapping candidate
   */
  async rejectMappingCandidate(id: string, userId: string): Promise<void> {
    await mysqlDb.execute(
      `UPDATE legacy_mapping_candidates
       SET approved_status = 'rejected', approved_by = ?, approved_at = NOW()
       WHERE id = ?`,
      [userId, id]
    );
  }
  
  /**
   * Get all active sync maps
   */
  async getSyncMaps(): Promise<SyncMap[]> {
    const [rows] = await mysqlDb.execute<any[]>(
      `SELECT * FROM legacy_sync_map
       WHERE active_status = 1
       ORDER BY sync_order ASC, hrms_domain ASC`
    );
    
    return rows.map(row => ({
      ...row,
      column_mapping_json: JSON.parse(row.column_mapping_json || '{}'),
      transform_rules_json: JSON.parse(row.transform_rules_json || 'null'),
    }));
  }
  
  /**
   * Get sync status (checkpoints, recent runs)
   */
  async getSyncStatus(): Promise<any> {
    const [maps] = await mysqlDb.execute<any[]>(
      `SELECT COUNT(*) as total_maps, 
              SUM(active_status) as active_maps
       FROM legacy_sync_map`
    );
    
    const [recentRuns] = await mysqlDb.execute<any[]>(
      `SELECT * FROM legacy_sync_run_log
       ORDER BY started_at DESC
       LIMIT 10`
    );
    
    const [exceptions] = await mysqlDb.execute<any[]>(
      `SELECT COUNT(*) as unresolved_exceptions
       FROM legacy_sync_exception
       WHERE resolved_status = 'pending'`
    );
    
    return {
      totalMaps: maps[0]?.total_maps || 0,
      activeMaps: maps[0]?.active_maps || 0,
      recentRuns,
      unresolvedExceptions: exceptions[0]?.unresolved_exceptions || 0,
      syncEnabled: env.LEGACY_SYNC_ENABLED,
    };
  }
}

export const legacyService = new LegacyService();
