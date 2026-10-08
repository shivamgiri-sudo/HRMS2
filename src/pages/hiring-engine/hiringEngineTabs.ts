/** The tab id of a location hash: the part before the first ":" or "?" ("#drives:plan?from=..." gives "drives"). Unknown or garbage gives the fallback. */
export function tabFromHash<T extends string>(hash: string, ids: readonly T[], fallback: T): T {
  if (typeof hash !== "string" || !hash.startsWith("#")) return fallback;
  const body = hash.slice(1);
  const cuts = [body.indexOf(":"), body.indexOf("?")].filter((i) => i >= 0);
  const head = cuts.length ? body.slice(0, Math.min(...cuts)) : body;
  return ids.find((id) => id === head) ?? fallback;
}
