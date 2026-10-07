/** The tab id of a location hash: the part before the first ":" ("#drives:plan?from=..." gives "drives"). Unknown or garbage gives the fallback. */
export function tabFromHash<T extends string>(hash: string, ids: readonly T[], fallback: T): T {
  if (typeof hash !== "string" || !hash.startsWith("#")) return fallback;
  const body = hash.slice(1);
  const colon = body.indexOf(":");
  const head = colon < 0 ? body : body.slice(0, colon);
  return ids.find((id) => id === head) ?? fallback;
}
