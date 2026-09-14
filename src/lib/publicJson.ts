/**
 * JSON reading for the public, token-authenticated pages.
 *
 * The three public e-sign screens — joining kit, per-document review and EPF
 * compliance review — are all reached from an email by someone with no session,
 * and all sit behind nginx. When the backend is not up, nginx answers with its
 * own HTML error page, and `await response.json()` on that throws
 *
 *     Unexpected token '<', "<html> <h"... is not valid JSON
 *
 * which is what a candidate saw while holding a link that was completely valid.
 * The wording matters as much as the guard: to the reader, a JSON parse error is
 * indistinguishable from a broken link, so they ask HR to reissue a link that
 * never needed reissuing.
 *
 * An HTML body here always means the gateway and never a bad token — the SPA
 * fallback would begin with `<!doctype`, and a genuinely invalid token returns a
 * JSON 404 from joiningKitPublic.service.
 */
export async function readPublicJson(response: Response): Promise<Record<string, any>> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      "The signing service is temporarily unavailable. Your link is still valid — please try again in a few minutes.",
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error(
      "The signing service returned an unreadable response. Your link is still valid — please try again in a few minutes.",
    );
  }
}
