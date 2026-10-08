import { describe, it, expect, vi } from "vitest";
import { buildTimeline, loadTimelineSection, type TimelineEvent } from "../dossier.timeline.js";
import { buildWindow } from "../dossierTypes.js";

function executor(map: Record<string, unknown[] | Error>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      const v = key ? map[key] : [];
      if (v instanceof Error) throw v;
      return [v, []];
    }),
  };
}
const w = buildWindow("e1", "2026-09-10", 12);

describe("buildTimeline", () => {
  it("sorts newest first and drops events without a date", () => {
    const events: TimelineEvent[] = [
      { date: "2026-01-01", kind: "joining", title: "Joined", detail: null },
      { date: "2026-06-01", kind: "promotion", title: "Promoted", detail: null },
      { date: "", kind: "other", title: "No date", detail: null },
    ];
    expect(buildTimeline(events).map((e) => e.title)).toEqual(["Promoted", "Joined"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, kind: "x", title: `e${i}`, detail: null }));
    expect(buildTimeline(many, 100)).toHaveLength(100);
  });
});

describe("loadTimelineSection", () => {
  it("merges history tables and lifecycle events into one list", async () => {
    const ex = executor({
      "FROM employee_journey_log": [{ event_date: "2025-07-15", event_type: "joined", description: "Joined as Agent" }],
      "FROM employee_job_history": [{ effective_date: "2026-01-01", change_type: "designation", reason: "Annual review" }],
      "FROM promotion_record": [],
      "FROM transfer_record": [{ effective_date: "2026-03-01", transfer_type: "process", from_value: "A", to_value: "B", status: "completed" }],
      "FROM employee_warning": [{ warning_date: "2026-05-01", severity: "written", category: "attendance" }],
      "FROM exit_request": [{ event_date: "2026-09-10", exit_sub_type: "resignation", status: "exited" }],
      "FROM employee_reactivation_requests": [{ event_date: "2026-09-25", status: "pending" }],
    });
    const t = await loadTimelineSection(ex as never, w);
    expect(t.events.map((e) => e.kind)).toEqual(["rejoin_request", "exit", "warning", "transfer", "job_change", "joining"]);
    expect(t.events[0]!.date).toBe("2026-09-25");
    expect(t.skipped).toEqual([]);
  });

  it("skips a source whose query fails and reports it, keeping the rest", async () => {
    const ex = executor({
      "FROM employee_journey_log": [{ event_date: "2025-07-15", event_type: "joined", description: "Joined" }],
      "FROM promotion_record": new Error("Unknown column 'status'"),
    });
    const t = await loadTimelineSection(ex as never, w);
    expect(t.events).toHaveLength(1);
    expect(t.skipped).toEqual(["promotion_record"]);
  });
});
