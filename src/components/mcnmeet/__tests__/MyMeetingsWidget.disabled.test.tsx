import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn(async () => ({ meetings: [], total: 0 })) }));
vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get } }));

import { MyMeetingsWidget } from "@/components/mcnmeet/MyMeetingsWidget";

function render(config: Record<string, unknown> | null, meetings?: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (config) qc.setQueryData(["mcnmeet", "config"], config);
  if (meetings) qc.setQueryData(["mcnmeet", "my-meetings", { status: "scheduled" }], meetings);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MyMeetingsWidget />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MyMeetingsWidget", () => {
  it("shows a disabled state and never asks for meetings when MCNmeet is off", () => {
    get.mockClear();
    const html = render({ enabled: false, can_create: false, allowed_meeting_types: [] });
    expect(html).toContain("Meetings are not enabled");
    expect(html).not.toContain("View all meetings");
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining("/api/mcnmeet/my-meetings"));
  });

  it("lists meetings when MCNmeet is on", () => {
    const html = render(
      { enabled: true, can_create: false, allowed_meeting_types: [] },
      { meetings: [], total: 0 },
    );
    expect(html).toContain("No upcoming meetings");
    expect(html).toContain("View all meetings");
  });
});
