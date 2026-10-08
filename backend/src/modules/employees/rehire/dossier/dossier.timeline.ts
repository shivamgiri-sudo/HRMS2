import type { RowDataPacket } from "mysql2";
import { type DossierWindow, type SqlExecutor } from "./dossierTypes.js";

export interface TimelineEvent {
  /** 'YYYY-MM-DD' */
  date: string;
  kind: string;
  title: string;
  detail: string | null;
}

export interface TimelineSection {
  events: TimelineEvent[];
  /** Sources whose query failed and were left out, so the page can say the timeline is incomplete. */
  skipped: string[];
}

export function buildTimeline(events: TimelineEvent[], limit = 100): TimelineEvent[] {
  return events
    .filter((e) => e.date && e.date.length >= 10)
    .map((e) => ({ ...e, date: e.date.slice(0, 10) }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit);
}

interface Source {
  table: string;
  sql: string;
  map: (r: RowDataPacket) => TimelineEvent;
}

const fmt = (col: string) => `DATE_FORMAT(${col}, '%Y-%m-%d')`;

// Several of these tables were read from SQL files, not a live database, so each source is isolated: a wrong
// column drops that one source (reported in `skipped`) and never the page.
const SOURCES: Source[] = [
  {
    table: "employee_journey_log",
    sql: `SELECT ${fmt("event_date")} AS event_date, event_type, description FROM employee_journey_log WHERE employee_id = ? ORDER BY event_date DESC LIMIT 60`,
    map: (r) => ({ date: String(r.event_date ?? ""), kind: "joining", title: String(r.description ?? r.event_type ?? "Event"), detail: r.event_type ?? null }),
  },
  {
    table: "employee_job_history",
    sql: `SELECT ${fmt("effective_date")} AS effective_date, change_type, reason FROM employee_job_history WHERE employee_id = ? ORDER BY effective_date DESC LIMIT 40`,
    map: (r) => ({ date: String(r.effective_date ?? ""), kind: "job_change", title: `Job change: ${r.change_type ?? "update"}`, detail: r.reason ?? null }),
  },
  {
    table: "promotion_record",
    sql: `SELECT ${fmt("effective_date")} AS effective_date, status FROM promotion_record WHERE employee_id = ? ORDER BY effective_date DESC LIMIT 20`,
    map: (r) => ({ date: String(r.effective_date ?? ""), kind: "promotion", title: "Promotion", detail: r.status ?? null }),
  },
  {
    table: "transfer_record",
    sql: `SELECT ${fmt("effective_date")} AS effective_date, transfer_type, from_value, to_value, status FROM transfer_record WHERE employee_id = ? ORDER BY effective_date DESC LIMIT 20`,
    map: (r) => ({ date: String(r.effective_date ?? ""), kind: "transfer", title: `Transfer (${r.transfer_type ?? "n/a"}): ${r.from_value ?? "?"} → ${r.to_value ?? "?"}`, detail: r.status ?? null }),
  },
  {
    table: "employee_warning",
    sql: `SELECT ${fmt("warning_date")} AS warning_date, severity, category FROM employee_warning WHERE employee_id = ? ORDER BY warning_date DESC LIMIT 20`,
    map: (r) => ({ date: String(r.warning_date ?? ""), kind: "warning", title: `${r.severity ?? ""} warning`.trim(), detail: r.category ?? null }),
  },
  {
    table: "exit_request",
    sql: `SELECT ${fmt("COALESCE(last_working_day_confirmed, last_working_day_proposed, created_at)")} AS event_date, exit_sub_type, status FROM exit_request WHERE employee_id = ? AND LOWER(status) NOT IN ('draft') ORDER BY created_at DESC LIMIT 10`,
    map: (r) => ({ date: String(r.event_date ?? ""), kind: "exit", title: `Exit: ${r.exit_sub_type ?? "n/a"}`, detail: r.status ?? null }),
  },
  {
    table: "employee_reactivation_requests",
    sql: `SELECT ${fmt("created_at")} AS event_date, status FROM employee_reactivation_requests WHERE employee_id = ? ORDER BY created_at DESC LIMIT 10`,
    map: (r) => ({ date: String(r.event_date ?? ""), kind: "rejoin_request", title: "Rejoin request raised", detail: r.status ?? null }),
  },
];

export async function loadTimelineSection(db: SqlExecutor, w: DossierWindow): Promise<TimelineSection> {
  const events: TimelineEvent[] = [];
  const skipped: string[] = [];
  for (const s of SOURCES) {
    try {
      const [rows] = await db.execute<RowDataPacket[]>(s.sql, [w.employeeId]);
      for (const r of rows) events.push(s.map(r));
    } catch {
      skipped.push(s.table);
    }
  }
  return { events: buildTimeline(events), skipped };
}
