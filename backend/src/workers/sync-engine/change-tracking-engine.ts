// @ts-nocheck
import { getLegacyPool } from '../../db/legacyDb.js';
import type { LegacyChange } from '../../modules/legacy/types.js';

/**
 * SQL Server Change Tracking Engine
 * Fetches incremental changes using SQL Server's CHANGETABLE function
 */
export class ChangeTrackingEngine {
  
  /**
   * Fetch changes from SQL Server using Change Tracking
   * @param schema - SQL Server schema name
   * @param table - SQL Server table name
   * @param lastVersion - Last processed CT version (from checkpoint)
   * @param batchSize - Max records to fetch
   */
  async fetchChanges(
    schema: string,
    table: string,
    lastVersion: bigint | null,
    batchSize: number = 1000
  ): Promise<{ changes: LegacyChange[]; currentVersion: bigint }> {
    const pool = await getLegacyPool();
    
    // Get current CT version
    const versionResult = await pool.request().query('SELECT CHANGE_TRACKING_CURRENT_VERSION() AS current_version');
    const currentVersion = BigInt(versionResult.recordset[0].current_version);
    
    if (lastVersion === null) {
      // Initial sync - no CT, would need full table scan (NOT IMPLEMENTED - requires manual setup)
      console.warn(`[CT] No checkpoint for ${schema}.${table} - need initial sync setup`);
      return { changes: [], currentVersion };
    }
    
    // Fetch changes since lastVersion
    const query = `
      SELECT 
        CT.SYS_CHANGE_VERSION,
        CT.SYS_CHANGE_OPERATION,
        T.*
      FROM CHANGETABLE(CHANGES ${schema}.${table}, @last_version) AS CT
      LEFT OUTER JOIN ${schema}.${table} AS T ON CT.SYS_CHANGE_COLUMNS IS NOT NULL
      WHERE CT.SYS_CHANGE_VERSION <= @current_version
      ORDER BY CT.SYS_CHANGE_VERSION
      OFFSET 0 ROWS FETCH NEXT @batch_size ROWS ONLY
    `;
    
    const result = await pool.request()
      .input('last_version', lastVersion.toString())
      .input('current_version', currentVersion.toString())
      .input('batch_size', batchSize)
      .query(query);
    
    const changes: LegacyChange[] = result.recordset.map(row => ({
      SYS_CHANGE_VERSION: BigInt(row.SYS_CHANGE_VERSION),
      SYS_CHANGE_OPERATION: row.SYS_CHANGE_OPERATION,
      ...row,
    }));
    
    console.log(`[CT] ${schema}.${table}: Found ${changes.length} changes (v${lastVersion} → v${currentVersion})`);
    
    return { changes, currentVersion };
  }
  
  /**
   * Check if Change Tracking is enabled on a table
   */
  async isChangeTrackingEnabled(schema: string, table: string): Promise<boolean> {
    const pool = await getLegacyPool();
    
    const result = await pool.request()
      .input('schema', schema)
      .input('table', table)
      .query(`
        SELECT COUNT(*) as enabled
        FROM sys.change_tracking_tables ct
        INNER JOIN sys.tables t ON ct.object_id = t.object_id
        INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE s.name = @schema AND t.name = @table
      `);
    
    return result.recordset[0].enabled > 0;
  }
}

export const changeTrackingEngine = new ChangeTrackingEngine();
