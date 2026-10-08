/**
 * Show-rate buckets. An unplanned arrival is a walk-in whose match was never booked (arrival sync promoted a suggested match: state arrived /
 * selected and no slot ever reserved; every invite reserves a slot, and a corrected no-show keeps its slot). It counts as an arrival in the
 * funnel and for drive credit, but it is not a sample of "invited -> showed", so the rate buckets leave it out. Alias `m` is he_match.
 */
export const UNPLANNED_ARRIVAL = "(m.state IN ('arrived','selected') AND m.slot_at IS NULL)";
export const RATE_INVITED_SQL = `SUM(m.state IN ('invited','confirmed','slot_released','arrived','no_show','selected') AND NOT ${UNPLANNED_ARRIVAL}) AS invited`;
export const RATE_ARRIVED_SQL = `SUM(m.state IN ('arrived','selected') AND NOT ${UNPLANNED_ARRIVAL}) AS arrived`;
