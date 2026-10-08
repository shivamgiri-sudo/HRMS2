/**
 * A no_show timeline event stays in he_lead_event (append-only), but when the same person later registered at the branch on that drive
 * day (arrival sync wrote an 'arrived' event for the same lead and drive) the no-show was wrong and must not count: not toward the
 * 3-no-shows-per-requisition cap, not as a past no-show in show-up learning or the slot forecast. `e` is the he_lead_event alias.
 * The NOT EXISTS reaches he_lead_event by idx_he_event_drive (drive_id, event_type).
 */
export const countedNoShow = (e: string): string =>
  `${e}.event_type = 'no_show' AND NOT EXISTS (SELECT 1 FROM he_lead_event ax WHERE ax.drive_id = ${e}.drive_id AND ax.event_type = 'arrived' AND ax.lead_id = ${e}.lead_id)`;
