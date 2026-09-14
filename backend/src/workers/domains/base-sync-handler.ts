import type { LegacyChange, TransformedRecord, ValidationResult, StagingResult, MergeResult } from '../../modules/legacy/types.js';

/**
 * Abstract base class for domain-specific sync handlers
 * Implements staging-then-merge pattern
 */
export abstract class BaseSyncHandler {
  protected domainName: string;
  protected stagingTable: string;
  
  constructor(domainName: string, stagingTable: string) {
    this.domainName = domainName;
    this.stagingTable = stagingTable;
  }
  
  /**
   * Full sync pipeline: Fetch → Transform → Validate → Stage → Merge
   */
  async syncDomain(syncRunId: string, changes: LegacyChange[]): Promise<{ inserted: number; updated: number }> {
    console.log(`[${this.domainName}] Processing ${changes.length} changes`);
    
    // Transform legacy records to HRMS format
    const transformed = changes.map(change => this.transform(change));
    
    // Validate transformed records
    const validated = transformed.filter(record => {
      const validation = this.validate(record);
      if (!validation.valid) {
        console.warn(`[${this.domainName}] Validation failed:`, validation.errors);
      }
      return validation.valid;
    });
    
    // Stage records
    const stagingResult = await this.stage(syncRunId, validated);
    console.log(`[${this.domainName}] Staged ${stagingResult.staged} records`);
    
    // Merge staged → final tables
    const mergeResult = await this.merge(syncRunId);
    console.log(`[${this.domainName}] Merged: ${mergeResult.inserted} inserted, ${mergeResult.updated} updated`);
    
    return mergeResult;
  }
  
  /**
   * Transform legacy record to HRMS format
   * Must be implemented by each domain handler
   */
  protected abstract transform(change: LegacyChange): TransformedRecord;
  
  /**
   * Validate transformed record
   * Must be implemented by each domain handler
   */
  protected abstract validate(record: TransformedRecord): ValidationResult;
  
  /**
   * Stage records (insert into staging table)
   * Must be implemented by each domain handler
   */
  protected abstract stage(syncRunId: string, records: TransformedRecord[]): Promise<StagingResult>;
  
  /**
   * Merge staged records into final HRMS tables
   * Must be implemented by each domain handler
   */
  protected abstract merge(syncRunId: string): Promise<MergeResult>;
  
  /**
   * Get domain name
   */
  getDomainName(): string {
    return this.domainName;
  }
}
