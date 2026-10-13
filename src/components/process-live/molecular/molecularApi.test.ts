import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ getAuthToken: () => "t" }));

const { defaultFilters, emailDashApi, EMAIL_DASHBOARDS, molApi } = await import("./molecularApi");

function mockFetch(status = 200) {
  const fn = vi.fn(async () => ({ status, ok: status < 400, json: async () => ({ ok: true, data: { rows: [] } }) }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("email dashboard sources", () => {
  it("gives each source its own title, route, API group and campaign", () => {
    expect(EMAIL_DASHBOARDS.molecular).toMatchObject({
      title: "Molecular Email Dashboard", route: "/molecular-email-dashboard",
      apiGroup: "molecular-email", campaign: "MOEMAIL",
    });
    expect(EMAIL_DASHBOARDS.reginald).toMatchObject({
      title: "Reginald Email Dashboard", route: "/reginald-email-dashboard",
      apiGroup: "reginald-email", campaign: "EMAIL",
    });
  });

  it.each([
    ["molecular", "/api/process-live/molecular-email"],
    ["reginald", "/api/process-live/reginald-email"],
  ] as const)("%s calls only its own endpoints", async (source, base) => {
    const fetchFn = mockFetch();
    const api = emailDashApi(source);
    const f = defaultFilters("2026-10-01", "2026-10-02");
    await api.overview(f);
    await api.tickets(f);
    await api.agentDaily(f);
    await api.filterOptions();
    await api.aprSummary(f);
    const paths = fetchFn.mock.calls.map((c) => String((c as unknown[])[0]).split("?")[0]);
    expect(paths).toEqual(["overview", "ticket-list", "agent-daily", "filter-options", "summary"].map((p) => `${base}/${p}`));
  });

  it("names the right dashboard on a 403", async () => {
    mockFetch(403);
    await expect(emailDashApi("reginald").filterOptions()).rejects.toThrow("Reginald Email Dashboard");
    await expect(molApi.filterOptions()).rejects.toThrow("Molecular Email Dashboard");
  });
});
