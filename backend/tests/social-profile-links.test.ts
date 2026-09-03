import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "../src/db/mysql.js";
import * as repo from "../src/modules/social-feed/social-feed.repository.js";
import * as service from "../src/modules/social-feed/social-feed.service.js";
import { socialLinksPublicRouter } from "../src/modules/social-feed/social-links.public.routes.js";
import { socialFeedRouter } from "../src/modules/social-feed/social-feed.routes.js";

/**
 * Cover for social_profile_link (migration 1656) — the six public company
 * social URLs that used to be hardcoded in the React bundle.
 *
 * The two behaviours that matter live outside the happy path: the login page
 * has no session and must still render its icon row when the table is missing
 * (migration not yet applied) or the read fails, and a save must not silently
 * write nothing when a seed row is absent.
 */

const query = db.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue([[], []]);
});

describe("getProfileLinks — reading", () => {
  it("returns all six platforms even when the table holds only one row", async () => {
    query.mockResolvedValue([
      [
        {
          platform: "instagram",
          label: "Instagram",
          profile_url: "https://instagram.com/mascallnet",
          handle: "@mascallnet",
          display_order: 3,
          enabled: 1,
        },
      ],
      [],
    ]);

    const links = await service.getProfileLinks();

    expect(links.map((l) => l.platform)).toEqual([
      "website",
      "linkedin",
      "instagram",
      "twitter",
      "facebook",
      "youtube",
    ]);
    expect(links.find((l) => l.platform === "instagram")?.profile_url).toBe(
      "https://instagram.com/mascallnet",
    );
    // The five platforms with no stored row fall back rather than vanishing.
    expect(links.find((l) => l.platform === "youtube")?.profile_url).toContain("youtube.com");
  });

  it("serves the bundled defaults when migration 1656 has not been applied", async () => {
    const missingTable = Object.assign(new Error("Table 'social_profile_link' doesn't exist"), {
      errno: 1146,
    });
    query.mockRejectedValue(missingTable);

    const rows = await repo.getProfileLinks();
    expect(rows).toEqual([]); // repo swallows 1146 only

    const links = await service.getProfileLinks();
    expect(links).toHaveLength(6);
    expect(links.find((l) => l.platform === "instagram")?.profile_url).toBe(
      "https://instagram.com/mascallnet",
    );
  });

  it("does NOT swallow any other database error", async () => {
    query.mockRejectedValue(Object.assign(new Error("connection lost"), { errno: 2013 }));
    await expect(repo.getProfileLinks()).rejects.toThrow(/connection lost/);
  });

  it("normalises the TINYINT enabled flag to a boolean", async () => {
    query.mockResolvedValue([
      [
        {
          platform: "facebook",
          label: "Facebook",
          profile_url: "https://www.facebook.com/TeamMas9",
          handle: "TeamMas9",
          display_order: 5,
          enabled: 0,
        },
      ],
      [],
    ]);
    const [row] = await repo.getProfileLinks();
    expect(row.enabled).toBe(false);
  });
});

describe("saveProfileLink — writing", () => {
  it("upserts, so a platform whose seed row is missing is created rather than silently skipped", async () => {
    await repo.saveProfileLink(
      { platform: "instagram", profile_url: "https://instagram.com/mascallnet", handle: "@mascallnet" },
      "user-1",
    );

    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO social_profile_link/i);
    expect(String(sql)).toMatch(/ON DUPLICATE KEY UPDATE/i);
    expect(String(sql)).not.toMatch(/^\s*UPDATE /i);
    expect(params).toContain("https://instagram.com/mascallnet");
    expect(params).toContain("user-1");
  });

  it("writes every platform it is handed", async () => {
    await service.saveProfileLinks(
      [
        { platform: "instagram", profile_url: "https://instagram.com/mascallnet" },
        { platform: "linkedin", profile_url: "https://www.linkedin.com/company/mas-callnet" },
      ],
      "user-1",
    );
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe("route wiring", () => {
  const paths = (router: any) =>
    router.stack
      .filter((l: any) => l.route)
      .map((l: any) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);

  it("exposes the public read with no auth middleware in front of it", () => {
    expect(paths(socialLinksPublicRouter)).toContain("GET /");
    // requireAuth is applied by socialFeedRouter, not here — that is the whole
    // point of this router existing separately.
    const middlewareBeforeRoutes = socialLinksPublicRouter.stack.filter((l: any) => !l.route);
    expect(middlewareBeforeRoutes).toHaveLength(0);
  });

  it("keeps the editable admin endpoints on the authenticated router", () => {
    const adminPaths = paths(socialFeedRouter);
    expect(adminPaths).toContain("GET /admin/profile-links");
    expect(adminPaths).toContain("PUT /admin/profile-links");
  });
});
