/** Pure helpers for the Responses tab's pickers: upcoming drives (today .. 14 days, not closed) and campaign options. No DOM. */
export interface DriveOption { id: string; date: string; label: string; confirmed: number }
type DriveRow = { id?: unknown; drive_date?: unknown; status?: unknown; branch_name?: unknown; requisition_code?: unknown; designation_name?: unknown; confirmed?: unknown };

const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Drives of GET /api/he/drives from today to today + 14 that are not closed, soonest first. */
export function nextDrives(data: unknown, today: string): DriveOption[] {
  const last = addDays(today, 14);
  return (Array.isArray(data) ? (data as DriveRow[]) : [])
    .filter((d) => typeof d.id === "string" && typeof d.drive_date === "string" && d.status !== "closed")
    .map((d) => ({ d, date: String(d.drive_date).slice(0, 10) }))
    .filter((x) => x.date >= today && x.date <= last)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.d.branch_name ?? "").localeCompare(String(b.d.branch_name ?? ""))))
    .map(({ d, date }) => {
      const confirmed = Number(d.confirmed ?? 0) || 0;
      return { id: String(d.id), date, confirmed, label: `${date === today ? "Today" : date} · ${String(d.branch_name ?? "")} · ${String(d.requisition_code ?? "")} ${String(d.designation_name ?? "")} (${confirmed} confirmed)`.replace(/\s+/g, " ").trim() };
    });
}

/** Campaign options from GET /api/he/campaign-config. */
export function campaignOptions(data: unknown): Array<{ id: string; label: string }> {
  return (Array.isArray(data) ? (data as Array<{ campaignId?: unknown; campaignName?: unknown }>) : [])
    .filter((c) => typeof c.campaignId === "string")
    .map((c) => ({ id: String(c.campaignId), label: String(c.campaignName ?? c.campaignId) }));
}
