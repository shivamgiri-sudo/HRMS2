import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../company-posts.service.ts", import.meta.url),
  "utf8",
);

describe("company feed production SQL contracts", () => {
  it("declares the post alias in count queries and uses safe integer pagination", () => {
    expect(source).toContain("SELECT COUNT(*) AS total FROM company_posts cp");
    expect(source).not.toContain("LIMIT ? OFFSET ?");
    expect(source).toContain("LIMIT ${limit} OFFSET ${offset}");
  });

  it("resolves creator departments through department_master", () => {
    expect(source).not.toMatch(/\be\.department(?:\s|,)/);
    expect(source).toContain("dept.dept_name AS department");
    expect(source).toContain("LEFT JOIN department_master dept ON dept.id = e.department_id");
  });
});
