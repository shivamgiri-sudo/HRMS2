/**
 * GitHub OIDC token verification for the CI callback endpoints.
 *
 * WHAT THIS PROTECTS
 *   /api/uat-internal/* is mounted BEFORE requireAuth, because a GitHub-hosted runner has no
 *   HRMS session. Its only credential is an OIDC token. If this file accepts a token it
 *   should not, an attacker who can trigger a workflow in any fork can record build results
 *   against a real feedback item — which is the whole trust boundary of Phase 4.
 *
 * WHY THE REPOSITORY NAME IS NOT ENOUGH
 *   The obvious check — "does the token say repository == shivamgiri-sudo/HRMS2" — is
 *   satisfied by a token minted from a pull_request event on a fork's branch, and by a token
 *   from an unrelated workflow in the same repository. Both would be accepted. So every
 *   claim below is checked, and each one closes a specific hole:
 *
 *     iss                    the token came from GitHub at all
 *     aud                    it was minted FOR us, not for another service that trusts GitHub
 *     repository             the right repository
 *     repository_owner       and the right owner, so a same-named repo elsewhere fails
 *     repository_visibility  refuses while the repository is public (Gate G2, enforced
 *                            rather than remembered)
 *     job_workflow_ref       the exact workflow FILE and ref — closes "another workflow in
 *                            this repo can call the callback"
 *     workflow_ref           the workflow's own ref
 *     ref                    the execution ref, so a run on some other branch fails
 *     event_name             workflow_dispatch only; a pull_request run from a fork cannot
 *                            reach this even with everything else right
 *     run_id / run_attempt   ties the callback to one specific run
 *     sha                    and to one specific commit
 *
 * FAIL CLOSED, ALWAYS
 *   Every unknown is a rejection. A missing claim, an unparseable token, an unreachable JWKS
 *   endpoint, an unconfigured expectation — all reject. There is no path through this file
 *   that accepts a token because something could not be checked.
 *
 * ⚠ PHASE 4 IS HELD. This code is inert until the gates in uat_gate_status are met and the
 *   builds_enabled switch is turned on. It is written and tested now so that turning it on
 *   later is an operator action rather than a development project.
 */
import { createVerify, createPublicKey } from "node:crypto";

export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = `${GITHUB_ISSUER}/.well-known/jwks`;

/** Every claim the backend requires. All of them; none is optional. */
export interface OidcExpectations {
  audience: string;
  repository: string;
  repositoryOwner: string;
  /** The exact workflow file path, e.g. ".github/workflows/uat-build.yml". */
  workflowPath: string;
  /** The only ref a build may execute from, e.g. "refs/heads/main". */
  allowedRef: string;
  /**
   * Refuse while the repository is public. G2 is a gate in a table AND a claim check here,
   * because a gate someone can forget to re-check after flipping the repository back to
   * public is not a control.
   */
  requirePrivate: boolean;
}

export interface GithubOidcClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  repository?: string;
  repository_owner?: string;
  repository_visibility?: string;
  job_workflow_ref?: string;
  workflow_ref?: string;
  ref?: string;
  event_name?: string;
  run_id?: string;
  run_attempt?: string;
  sha?: string;
  actor?: string;
  [k: string]: unknown;
}

export class OidcError extends Error {
  constructor(
    message: string,
    readonly claim: string
  ) {
    super(message);
    this.name = "OidcError";
  }
}

// ── JWKS ──────────────────────────────────────────────────────────────────────

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 10 * 60 * 1000;

/**
 * Fetch GitHub's signing keys.
 *
 * Cached for ten minutes: GitHub rotates these, so pinning them would break verification on
 * a rotation, and fetching on every callback would make the endpoint depend on an external
 * host per request. A stale cache is NOT used as a fallback when the fetch fails — a key
 * that has been rotated away is exactly the case where accepting the old one is wrong.
 */
export async function fetchJwks(fetchImpl: typeof fetch = fetch): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetchImpl(JWKS_URL, { method: "GET" });
  if (!res.ok) throw new OidcError(`Could not fetch GitHub JWKS (HTTP ${res.status}).`, "jwks");
  const body = (await res.json()) as { keys?: Jwk[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new OidcError("GitHub JWKS contained no keys.", "jwks");
  }
  jwksCache = { keys: body.keys, fetchedAt: Date.now() };
  return body.keys;
}

/** Exposed for tests; a stale cache must never leak between cases. */
export function resetJwksCache(): void {
  jwksCache = null;
}

function b64urlToBuffer(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Verify the RS256 signature.
 *
 * The algorithm is taken from OUR expectation, not from the token header. Trusting the
 * header's `alg` is the classic JWT flaw: a token claiming `alg: none`, or claiming HS256 so
 * the public key is used as an HMAC secret, verifies against a naive implementation.
 */
export function verifySignature(token: string, jwk: Jwk): boolean {
  const [headerB64, payloadB64, signatureB64] = token.split(".");
  if (!headerB64 || !payloadB64 || !signatureB64) return false;
  const key = createPublicKey({
    key: { kty: "RSA", n: jwk.n, e: jwk.e } as unknown as import("node:crypto").JsonWebKey,
    format: "jwk",
  });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  return verifier.verify(key, b64urlToBuffer(signatureB64));
}

export function decodeSegments(token: string): {
  header: { kid?: string; alg?: string };
  claims: GithubOidcClaims;
} {
  const parts = token.split(".");
  if (parts.length !== 3) throw new OidcError("Token is not a well-formed JWT.", "format");
  try {
    return {
      header: JSON.parse(b64urlToBuffer(parts[0]).toString("utf8")),
      claims: JSON.parse(b64urlToBuffer(parts[1]).toString("utf8")),
    };
  } catch {
    throw new OidcError("Token header or payload is not valid JSON.", "format");
  }
}

// ── Claim checks ──────────────────────────────────────────────────────────────

/**
 * Check every claim.
 *
 * Separated from signature verification so it can be tested exhaustively against a claim set
 * without needing a real signed token — and so that reading it, the full list of what is
 * required is visible in one place rather than interleaved with crypto.
 */
export function assertClaims(
  claims: GithubOidcClaims,
  expect: OidcExpectations,
  now: Date = new Date()
): void {
  const nowSec = Math.floor(now.getTime() / 1000);

  if (claims.iss !== GITHUB_ISSUER) {
    throw new OidcError(`Unexpected issuer: ${claims.iss ?? "(absent)"}.`, "iss");
  }

  // A single audience string or an array both occur. An empty expectation is a
  // configuration error, not a wildcard.
  if (!expect.audience) throw new OidcError("No expected audience is configured.", "aud");
  const auds = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!auds.includes(expect.audience)) {
    throw new OidcError(
      `Token was not minted for this service (aud ${JSON.stringify(claims.aud)}).`,
      "aud"
    );
  }

  if (typeof claims.exp !== "number" || claims.exp <= nowSec) {
    throw new OidcError("Token has expired or carries no expiry.", "exp");
  }
  // Small skew allowance in one direction only: a token from the future is far more likely
  // to be forged than to be a clock problem.
  if (typeof claims.nbf === "number" && claims.nbf > nowSec + 60) {
    throw new OidcError("Token is not valid yet.", "nbf");
  }

  if (claims.repository !== expect.repository) {
    throw new OidcError(`Wrong repository: ${claims.repository ?? "(absent)"}.`, "repository");
  }
  // Checked separately from `repository` so a repository of the same name under a different
  // owner cannot satisfy the check by coincidence.
  if (claims.repository_owner !== expect.repositoryOwner) {
    throw new OidcError(
      `Wrong repository owner: ${claims.repository_owner ?? "(absent)"}.`,
      "repository_owner"
    );
  }

  if (expect.requirePrivate && claims.repository_visibility !== "private") {
    throw new OidcError(
      "Refusing a token from a public repository. Automated builds require Gate G2 " +
        "(repository is private) to be satisfied.",
      "repository_visibility"
    );
  }

  // The claim looks like "owner/repo/.github/workflows/uat-build.yml@refs/heads/main".
  // Both halves are checked: the path stops another workflow in this repository from calling
  // the callback, and the ref stops the right workflow running from an attacker's branch.
  const expectedJobRef = `${expect.repository}/${expect.workflowPath}@${expect.allowedRef}`;
  if (claims.job_workflow_ref !== expectedJobRef) {
    throw new OidcError(
      `Wrong workflow or ref. Expected ${expectedJobRef}, got ${claims.job_workflow_ref ?? "(absent)"}.`,
      "job_workflow_ref"
    );
  }
  if (claims.workflow_ref !== expectedJobRef) {
    throw new OidcError(
      `workflow_ref does not match the permitted workflow: ${claims.workflow_ref ?? "(absent)"}.`,
      "workflow_ref"
    );
  }

  if (claims.ref !== expect.allowedRef) {
    throw new OidcError(
      `Builds may only execute from ${expect.allowedRef}; token ref is ${claims.ref ?? "(absent)"}.`,
      "ref"
    );
  }

  // The single most important claim after the signature. A fork's pull_request run cannot
  // reach here even if every other claim were somehow satisfied.
  if (claims.event_name !== "workflow_dispatch") {
    throw new OidcError(
      `Only workflow_dispatch runs may call back; this token is from ${claims.event_name ?? "(absent)"}.`,
      "event_name"
    );
  }

  for (const required of ["run_id", "run_attempt", "sha"] as const) {
    if (!claims[required]) {
      throw new OidcError(`Token is missing ${required}.`, required);
    }
  }
  if (!/^[0-9a-f]{40}$/i.test(String(claims.sha))) {
    throw new OidcError("Token sha is not a commit SHA.", "sha");
  }
}

export interface VerifiedToken {
  claims: GithubOidcClaims;
  repository: string;
  runId: string;
  runAttempt: number;
  sha: string;
  jobWorkflowRef: string;
}

/**
 * Full verification: signature first, then claims.
 *
 * Signature first on purpose — claim checks on an unverified payload tell you nothing, and
 * doing them first invites the mistake of logging or acting on attacker-controlled values
 * before establishing they came from GitHub.
 */
export async function verifyOidcToken(
  token: string,
  expect: OidcExpectations,
  deps: { fetchImpl?: typeof fetch; now?: Date } = {}
): Promise<VerifiedToken> {
  if (!token || typeof token !== "string") {
    throw new OidcError("No token was presented.", "format");
  }

  const { header, claims } = decodeSegments(token);

  // Taken from our own constant, never from the header.
  if (header.alg && header.alg !== "RS256") {
    throw new OidcError(`Unsupported token algorithm: ${header.alg}.`, "alg");
  }
  if (!header.kid) throw new OidcError("Token header carries no key id.", "kid");

  const keys = await fetchJwks(deps.fetchImpl ?? fetch);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new OidcError(`No GitHub signing key matches kid ${header.kid}.`, "kid");
  }
  if (!verifySignature(token, jwk)) {
    throw new OidcError("Token signature is not valid.", "signature");
  }

  assertClaims(claims, expect, deps.now ?? new Date());

  return {
    claims,
    repository: String(claims.repository),
    runId: String(claims.run_id),
    runAttempt: Number(claims.run_attempt),
    sha: String(claims.sha),
    jobWorkflowRef: String(claims.job_workflow_ref),
  };
}

/**
 * Expectations from the environment.
 *
 * Every field must be configured. An unset value throws rather than defaulting, because a
 * default here is a hole: "" would match nothing on a strict comparison, but a permissive
 * default like "*" would match everything, and the difference is one careless edit.
 */
export function expectationsFromEnv(env: NodeJS.ProcessEnv = process.env): OidcExpectations {
  const required = (key: string): string => {
    const value = env[key];
    if (!value) {
      throw new OidcError(
        `${key} is not configured. OIDC verification refuses to run with an unset expectation.`,
        key
      );
    }
    return value;
  };
  return {
    audience: required("UAT_OIDC_AUDIENCE"),
    repository: required("UAT_OIDC_REPOSITORY"),
    repositoryOwner: required("UAT_OIDC_REPOSITORY_OWNER"),
    workflowPath: env.UAT_OIDC_WORKFLOW_PATH || ".github/workflows/uat-build.yml",
    allowedRef: env.UAT_OIDC_ALLOWED_REF || "refs/heads/main",
    // Defaults to true. Someone who wants to relax this has to say so explicitly, and the
    // saying-so is visible in the environment rather than implied by an omission.
    requirePrivate: String(env.UAT_OIDC_ALLOW_PUBLIC_REPO ?? "").toLowerCase() !== "true",
  };
}
