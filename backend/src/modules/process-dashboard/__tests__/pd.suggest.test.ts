import { describe, expect, it } from "vitest";
import { compatible, guessTimeUnit, scoreHeader, suggestColumnMap, typeClass } from "../pd.suggest.js";

const c = (name: string, dataType = "int") => ({ name, dataType });

describe("suggestColumnMap", () => {
  it("maps a Dalmia-shaped header set", () => {
    const s = suggestColumnMap([c("id", "char"), c("process_id", "char"), c("report_date", "date"), c("emp_name", "varchar"), c("emp_id", "varchar"), c("calls_chats"), c("lob", "varchar"),
      c("login_time_sec"), c("wait_sec"), c("talk_sec"), c("dispo_sec"), c("total_break_sec"), c("utilization_pct", "decimal")]);
    expect(s.columnMap).toMatchObject({ agent_code: "emp_id", date: "report_date", agent_name: "emp_name", calls: "calls_chats", lob: "lob", login_sec: "login_time_sec", wait_sec: "wait_sec", talk_sec: "talk_sec", dispo_sec: "dispo_sec", break_sec: "total_break_sec" });
    expect(s.unmatched).toContain("amount");
  });
  it("maps a GNC-shaped table and respects types", () => {
    const s = suggestColumnMap([c("call_date", "date"), c("agent_id", "varchar"), c("agent_name", "varchar"), c("calls_handled"), c("sales_closed"), c("remarks", "text")]);
    expect(s.columnMap.date).toBe("call_date"); expect(s.columnMap.agent_code).toBe("agent_id"); expect(s.columnMap.sales_count).toBe("sales_closed");
  });
  it("never maps one column twice and never a text column to date", () => {
    const s = suggestColumnMap([c("report_date", "varchar"), c("agent_id", "varchar")]);
    expect(s.columnMap.date).toBeUndefined();
    const vals = Object.values(s.columnMap); expect(new Set(vals).size).toBe(vals.length);
  });
  it("never suggests sensitive columns", () => {
    const s = suggestColumnMap([c("agent_id", "varchar"), c("report_date", "date"), c("mobile_no", "varchar"), c("salary", "decimal"), c("amount", "decimal")]);
    expect(Object.values(s.columnMap)).not.toContain("mobile_no"); expect(Object.values(s.columnMap)).not.toContain("salary"); expect(s.columnMap.amount).toBe("amount");
  });
  it("exact synonym beats partial", () => expect(scoreHeader("calls", ["calls"])).toBeGreaterThan(scoreHeader("total_calls_x", ["calls"])));
  it("typeClass / compatible", () => {
    expect(typeClass("DECIMAL")).toBe("numeric"); expect(typeClass("datetime")).toBe("date"); expect(typeClass("json")).toBe("other");
    expect(compatible("date", "text")).toBe(false); expect(compatible("time", "time")).toBe(true); expect(compatible("count", "other")).toBe(false);
  });
});

describe("guessTimeUnit", () => {
  it("TIME column / clock text -> hhmmss", () => {
    expect(guessTimeUnit([{ dataType: "time", samples: [] }])).toBe("hhmmss");
    expect(guessTimeUnit([{ dataType: "varchar", samples: ["01:02:03", "00:10:00"] }])).toBe("hhmmss");
  });
  it("fractions in [0,1.5] -> day_fraction", () => expect(guessTimeUnit([{ dataType: "decimal", samples: [0.25, 0.3, 0.0417, 0.5] }])).toBe("day_fraction"));
  it("large integers -> sec; empty -> sec", () => {
    expect(guessTimeUnit([{ dataType: "int", samples: [3600, 28800, 120] }])).toBe("sec");
    expect(guessTimeUnit([{ dataType: "int", samples: [] }])).toBe("sec");
    expect(guessTimeUnit([{ dataType: "int", samples: [0, 0, 1] }])).toBe("sec"); // whole numbers only: not a fraction
  });
});
