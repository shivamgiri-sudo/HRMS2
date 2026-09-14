/**
 * OIDC claim verification — Gate G3.
 *
 * Every test here is an attack. The endpoint these claims protect is mounted before
 * requireAuth, so if any of these passes when it should not, an attacker who can trigger a
 * workflow can record build results against a real feedback item.
 *
 * The obvious check — "does the token say the right repository" — is satisfied by a token
 * from a fork's pull_request run and by a token from an unrelated workflow in the same
 * repository. Each test below closes one of those specific holes.
 */
import { describe, expect, it } from "vitest";
import {
  assertClaims,
  expectationsFromEnv,
  GITHUB_ISSUER,
  OidcError,
  type GithubOidcClaims,
  type OidcExpectations,
} from "../uat-oidc-verify.service.js";

const EXPECT: OidcExpectations = {
  audience: "hrms2-uat",
  repository: "shivamgiri-sudo/HRMS2",
  repositoryOwner: "shivamgiri-sudo",
  workflowPath: ".github/workflows/uat-build.yml",
  allowedRef: "refs/heads/main",
  requirePrivate: true,
};

const JOB_REF = `${EXPECT.repository}/${EXPECT.workflowPath}@${EXPECT.allowedRef}`;
const NOW = new Date("2026-08-08T12:00:00Z");

/** A token that should be accepted. Every test below mutates exactly one field of it. */
function goodClaims(over: Partial<GithubOidcClaims> = {}): GithubOidcClaims {
  return {
    iss: GITHUB_ISSUER,
    aud: "hrms2-uat",
    exp: Math.floor(NOW.getTime() / 1000) + 600,
    nbf: Math.floor(NOW.getTime() / 1000) - 10,
    repository: "shivamgiri-sudo/HRMS2",
    repository_owner: "shivamgiri-sudo",
    repository_visibility: "private",
    job_workflow_ref: JOB_REF,
    workflow_ref: JOB_REF,
    ref: "refs/heads/main",
    event_name: "workflow_dispatch",
    run_id: "12345678",
    run_attempt: "1",
    sha: "a".repeat(40),
    ...over,
  };
}

/** Assert the claim set is refused, and refused for the RIGHT reason. */
function expectRejected(claims: GithubOidcClaims, claim: string) {
  let error: unknown;
  try {
    assertClaims(claims, EXPECT, NOW);
  } catch (e) {
    error = e;
  }
  expect(error, `claims should have been rejected on "${claim}"`).toBeInstanceOf(OidcError);
  expect((error as OidcError).claim).toBe(claim);
}

describe("the baseline", () => {
  it("accepts a fully correct token", () => {
    expect(() => assertClaims(goodClaims(), EXPECT, NOW)).not.toThrow();
  });
});

describe("the attacks each claim closes", () => {
  it("rejects a token not issued by GitHub", () => {
    expectRejected(goodClaims({ iss: "https://evil.example.com" }), "iss");
  });

  it("rejects a token minted for a different service that also trusts GitHub", () => {
    // Without the aud check, any OIDC-consuming service's token would be accepted here.
    expectRejected(goodClaims({ aud: "some-other-service" }), "aud");
  });

  it("rejects an expired token", () => {
    expectRejected(goodClaims({ exp: Math.floor(NOW.getTime() / 1000) - 1 }), "exp");
  });

  it("rejects a token with no expiry at all", () => {
    const c = goodClaims();
    delete c.exp;
    expectRejected(c, "exp");
  });

  it("rejects a token from a different repository", () => {
    expectRejected(goodClaims({ repository: "attacker/HRMS2" }), "repository");
  });

  it("rejects a same-named repository under a different owner", () => {
    // repository and repository_owner are checked separately so this cannot pass by
    // coincidence of naming.
    expectRejected(
      goodClaims({ repository: "shivamgiri-sudo/HRMS2", repository_owner: "attacker" }),
      "repository_owner"
    );
  });

  it("rejects a token from a PUBLIC repository — G2, enforced not remembered", () => {
    expectRejected(goodClaims({ repository_visibility: "public" }), "repository_visibility");
  });

  it("rejects a DIFFERENT workflow in the same repository", () => {
    // This is the hole a repository-name-only check leaves wide open: any workflow in the
    // repo could call the callback.
    expectRejected(
      goodClaims({
        job_workflow_ref: `${EXPECT.repository}/.github/workflows/deploy.yml@refs/heads/main`,
      }),
      "job_workflow_ref"
    );
  });

  it("rejects the right workflow running from an attacker's branch", () => {
    expectRejected(
      goodClaims({
        job_workflow_ref: `${EXPECT.repository}/${EXPECT.workflowPath}@refs/heads/attacker`,
        workflow_ref: `${EXPECT.repository}/${EXPECT.workflowPath}@refs/heads/attacker`,
        ref: "refs/heads/attacker",
      }),
      "job_workflow_ref"
    );
  });

  it("rejects a workflow_ref that disagrees with job_workflow_ref", () => {
    expectRejected(
      goodClaims({ workflow_ref: `${EXPECT.repository}/.github/workflows/other.yml@refs/heads/main` }),
      "workflow_ref"
    );
  });

  it("rejects execution from any ref other than main", () => {
    const c = goodClaims({ ref: "refs/heads/feature" });
    // job_workflow_ref still says main, so this isolates the `ref` check specifically.
    expectRejected(c, "ref");
  });

  it("rejects a pull_request run — the fork attack", () => {
    // Even with everything else somehow correct, a fork's PR run cannot reach the callback.
    expectRejected(goodClaims({ event_name: "pull_request" }), "event_name");
  });

  it("rejects a push-triggered run", () => {
    expectRejected(goodClaims({ event_name: "push" }), "event_name");
  });

  it("rejects a token missing run_id, run_attempt or sha", () => {
    for (const field of ["run_id", "run_attempt", "sha"] as const) {
      const c = goodClaims();
      delete c[field];
      expectRejected(c, field);
    }
  });

  it("rejects a sha that is not a commit SHA", () => {
    expectRejected(goodClaims({ sha: "not-a-sha" }), "sha");
  });

  it("rejects a token from the future beyond the skew allowance", () => {
    expectRejected(goodClaims({ nbf: Math.floor(NOW.getTime() / 1000) + 3600 }), "nbf");
  });
});

describe("absent claims are rejections, not omissions", () => {
  it("rejects when EVERY optional-looking claim is simply missing", () => {
    // A token carrying only iss and aud must not pass because the other checks found
    // `undefined` and moved on.
    const bare: GithubOidcClaims = {
      iss: GITHUB_ISSUER,
      aud: "hrms2-uat",
      exp: Math.floor(NOW.getTime() / 1000) + 600,
    };
    expect(() => assertClaims(bare, EXPECT, NOW)).toThrow(OidcError);
  });

  it("rejects an empty claim object outright", () => {
    expect(() => assertClaims({}, EXPECT, NOW)).toThrow(OidcError);
  });
});

describe("configuration cannot fail open", () => {
  it("refuses to verify when no audience is configured", () => {
    // An empty expectation must not become a wildcard.
    expect(() => assertClaims(goodClaims(), { ...EXPECT, audience: "" }, NOW)).toThrow(OidcError);
  });

  it("throws rather than defaulting when an expectation env var is unset", () => {
    expect(() => expectationsFromEnv({} as NodeJS.ProcessEnv)).toThrow(OidcError);
  });

  it("requires a private repository unless someone explicitly says otherwise", () => {
    const e = expectationsFromEnv({
      UAT_OIDC_AUDIENCE: "hrms2-uat",
      UAT_OIDC_REPOSITORY: "shivamgiri-sudo/HRMS2",
      UAT_OIDC_REPOSITORY_OWNER: "shivamgiri-sudo",
    } as unknown as NodeJS.ProcessEnv);
    expect(e.requirePrivate).toBe(true);

    // Relaxing it has to be said out loud, in the environment, not implied by omission.
    const relaxed = expectationsFromEnv({
      UAT_OIDC_AUDIENCE: "hrms2-uat",
      UAT_OIDC_REPOSITORY: "shivamgiri-sudo/HRMS2",
      UAT_OIDC_REPOSITORY_OWNER: "shivamgiri-sudo",
      UAT_OIDC_ALLOW_PUBLIC_REPO: "true",
    } as unknown as NodeJS.ProcessEnv);
    expect(relaxed.requirePrivate).toBe(false);
  });

  it("defaults the workflow path and ref to the only ones a build may use", () => {
    const e = expectationsFromEnv({
      UAT_OIDC_AUDIENCE: "hrms2-uat",
      UAT_OIDC_REPOSITORY: "shivamgiri-sudo/HRMS2",
      UAT_OIDC_REPOSITORY_OWNER: "shivamgiri-sudo",
    } as unknown as NodeJS.ProcessEnv);
    expect(e.workflowPath).toBe(".github/workflows/uat-build.yml");
    expect(e.allowedRef).toBe("refs/heads/main");
  });
});
