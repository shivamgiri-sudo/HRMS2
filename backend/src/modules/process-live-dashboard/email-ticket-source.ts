/**
 * The email dashboards that share the per-ticket pipeline (molecular_email_ticket,
 * sql/migrations/2180/2181/2190). Both read the same ticketing server and schema;
 * only the source database, the excluded mailbox sender and the APR campaign differ.
 * Pure (no imports, no I/O).
 */

export type TicketSource = 'molecular' | 'reginald';

export interface TicketSourceConfig {
  source: TicketSource;
  /** Database on the ticketing server (read-only). */
  database: 'molecular_db_email' | 'db_email';
  /** Label the daily-count sync stores in email_ticket_daily_actual. */
  dashboardLabel: 'MOLECULAR' | 'REGINALD_MEN';
  /** The shared mailbox's own outbound address: its messages are not agent replies. */
  excludedSenderLike: string;
  /** Dialler APR campaign (vicidial_agent_log_10_25.campaign_id) holding the agents' time. */
  aprCampaign: string;
}

export const TICKET_SOURCES: Readonly<Record<TicketSource, TicketSourceConfig>> = {
  molecular: {
    source: 'molecular',
    database: 'molecular_db_email',
    dashboardLabel: 'MOLECULAR',
    excludedSenderLike: 'info@molecularcompany.com',
    aprCampaign: 'MOEMAIL',
  },
  reginald: {
    source: 'reginald',
    database: 'db_email',
    dashboardLabel: 'REGINALD_MEN',
    excludedSenderLike: 'info@reginaldmen.com',
    aprCampaign: 'EMAIL',
  },
};

export const TICKET_SOURCE_LIST: readonly TicketSource[] = ['molecular', 'reginald'];

/** Anything that is not a known source is refused (never interpolated into SQL). */
export function ticketSourceConfig(source: TicketSource): TicketSourceConfig {
  const cfg = TICKET_SOURCES[source];
  if (!cfg) throw new Error(`Unknown email ticket source: ${String(source)}`);
  return cfg;
}
