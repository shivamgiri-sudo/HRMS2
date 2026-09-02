/**
 * Google Sheets as a live KPI data source, via a "Publish to web" CSV URL.
 *
 * Google's File → Share → Publish to web → CSV gives a stable URL that always returns the sheet's
 * CURRENT contents. That makes it a genuine live source with no credential to store, no OAuth
 * consent screen, and no new npm dependency — which is why it is the route taken here rather than
 * service-account JWT auth against the Sheets API.
 *
 * The existing connectGoogleSheet() in quality-aggregator.service.ts is untouched and remains a
 * stub; it asked for a service-account JSON, had no implementation behind it, and always failed.
 * This path replaces it for KPI purposes.
 *
 * ── TWO THINGS THAT MATTER MORE THAN THE PARSING ────────────────────────────────────────────
 *
 * 1. SSRF. The URL is supplied by an administrator through an HTTP API and then fetched BY THE
 *    SERVER. Without a restriction, that is a request forgery primitive: a URL of
 *    http://169.254.169.254/latest/meta-data/ would have the backend read cloud instance
 *    credentials and hand them back as "sheet data", and http://localhost:5055/... would let it
 *    call its own internal endpoints from a trusted position. So the host is checked against a
 *    literal allowlist of Google's publishing domains, the scheme must be https, and redirects are
 *    NOT followed automatically — a 30x to an internal address is the same attack wearing a hat.
 *
 * 2. A published sheet is PUBLIC. Anyone holding the URL can read it, with no login. That is a
 *    property of Google's publish feature, not of this code, but since the data here is employee
 *    performance it has to be stated where an administrator will see it — which is why the UI
 *    carries the warning rather than leaving it implicit.
 */

import { assertSafeIdentifier } from '../integration-hub/adapters/databaseAdapter.js';

/**
 * Hosts a published Google Sheet CSV can legitimately live on.
 *
 * A literal list, matched on the exact hostname or a dotted suffix — not a regex or a substring
 * test. `url.hostname.includes("docs.google.com")` would accept
 * `docs.google.com.attacker.example`, and a regex without an anchor makes the same mistake less
 * visibly.
 */
const ALLOWED_HOSTS = ['docs.google.com', 'spreadsheets.google.com'] as const;
const ALLOWED_HOST_SUFFIXES = ['.googleusercontent.com'] as const;

/** A sheet of KPI figures is small. This bounds a mistyped URL pointing at something enormous. */
const MAX_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

export class SheetUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetUrlError';
  }
}

/**
 * Validates a published-CSV URL and returns it normalised.
 *
 * Exported so the API can reject a bad URL when it is SAVED rather than at compute time. A source
 * that only fails at 2am when the nightly job runs is a source nobody can debug.
 */
export function validateSheetCsvUrl(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) throw new SheetUrlError('Paste the published CSV link for the sheet');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new SheetUrlError('That is not a valid URL');
  }

  // https only. http would send the request in clear text and, more importantly, is the scheme an
  // SSRF payload reaches internal services on.
  if (url.protocol !== 'https:') {
    throw new SheetUrlError('The link must start with https://');
  }
  if (url.username || url.password) {
    throw new SheetUrlError('The link must not contain a username or password');
  }

  const host = url.hostname.toLowerCase();
  const allowed =
    ALLOWED_HOSTS.includes(host as (typeof ALLOWED_HOSTS)[number]) ||
    ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  if (!allowed) {
    throw new SheetUrlError(
      `Only published Google Sheets links are accepted (${ALLOWED_HOSTS.join(', ')}). ` +
        `Got "${url.hostname}".`,
    );
  }

  // A sheet URL that is not published returns Google's HTML login page rather than CSV, and the
  // failure then looks like "the sheet is empty". Checking for the publish markers up front turns
  // that into a sentence the administrator can act on.
  const looksPublished =
    url.pathname.includes('/pub') ||
    url.searchParams.get('output') === 'csv' ||
    url.pathname.endsWith('/export');
  if (!looksPublished) {
    throw new SheetUrlError(
      'That looks like a normal sheet link, not a published one. In the sheet use ' +
        'File → Share → Publish to web, choose the tab, pick "Comma-separated values (.csv)", ' +
        'then paste the link it gives you.',
    );
  }

  return url.toString();
}

export interface SheetFetchResult {
  headers: string[];
  rows: Array<Record<string, string>>;
  error?: string;
}

/**
 * Fetches and parses a published sheet.
 *
 * Returns an error in the result rather than throwing, so one unreachable sheet does not abort a
 * computation run that also covers KPIs from the dialer and from attendance. The caller records the
 * failure against the affected metrics.
 */
export async function fetchSheetCsv(csvUrl: string): Promise<SheetFetchResult> {
  let url: string;
  try {
    url = validateSheetCsvUrl(csvUrl);
  } catch (error) {
    return { headers: [], rows: [], error: error instanceof Error ? error.message : String(error) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      // Manual, not follow. Google answers a published CSV with a 307 to a googleusercontent.com
      // host, which is legitimate — but following automatically would also follow a redirect to
      // 169.254.169.254 or localhost, so each hop is re-validated against the allowlist below
      // instead of trusting the chain.
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'text/csv,text/plain,*/*' },
    });

    let finalResponse = response;
    let hops = 0;
    while (finalResponse.status >= 300 && finalResponse.status < 400 && hops < 5) {
      const location = finalResponse.headers.get('location');
      if (!location) break;
      const next = new URL(location, url).toString();
      // Re-validated on every hop. This is the check that makes redirect following safe.
      try {
        validateSheetCsvUrl(next);
      } catch {
        return {
          headers: [],
          rows: [],
          error: 'The link redirected somewhere unexpected and was not followed.',
        };
      }
      finalResponse = await fetch(next, { redirect: 'manual', signal: controller.signal });
      url = next;
      hops += 1;
    }

    if (!finalResponse.ok) {
      return {
        headers: [],
        rows: [],
        error:
          finalResponse.status === 404
            ? 'The sheet was not found. Check the link, and that it is still published.'
            : `The sheet could not be read (HTTP ${finalResponse.status}). Check that it is still published to the web.`,
      };
    }

    const contentType = finalResponse.headers.get('content-type') ?? '';
    // An unpublished sheet answers with an HTML sign-in page and a 200. Detecting that here means
    // the administrator is told the sheet is not published, instead of being told it is empty.
    if (contentType.includes('text/html')) {
      return {
        headers: [],
        rows: [],
        error:
          'The link returned a web page rather than CSV, which usually means the sheet is no longer ' +
          'published. Re-publish it under File → Share → Publish to web.',
      };
    }

    const text = await readCapped(finalResponse);
    const parsed = parseCsv(text);
    if (!parsed.headers.length) {
      return { headers: [], rows: [], error: 'The sheet appears to have no header row.' };
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { headers: [], rows: [], error: 'The sheet took too long to respond.' };
    }
    return { headers: [], rows: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Reads the body but stops at MAX_BYTES rather than buffering whatever arrives. */
async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) {
    throw new Error(`The sheet is larger than the ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit`);
  }

  const reader = response.body?.getReader();
  if (!reader) return await response.text();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error(`The sheet is larger than the ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit`);
      }
      chunks.push(value);
    }
  }

  return new TextDecoder('utf-8').decode(
    chunks.reduce<Uint8Array>((joined, chunk) => {
      const next = new Uint8Array(joined.length + chunk.length);
      next.set(joined);
      next.set(chunk, joined.length);
      return next;
    }, new Uint8Array()),
  );
}

/**
 * RFC 4180 CSV parser.
 *
 * Hand-written on purpose, and correct about the two things that matter: a comma inside quotes is
 * data, and a NEWLINE inside quotes is data. quality-aggregator.service.ts parses CSV with
 * `split('\n')` then `split(',')`, which breaks the first time a process name contains a comma —
 * and it breaks silently, shifting every subsequent column by one, so the numbers are wrong rather
 * than absent. That is the failure mode this avoids.
 */
export function parseCsv(text: string): { headers: string[]; rows: Array<Record<string, string>> } {
  // Strip a UTF-8 BOM: Google prefixes one, and left in place it becomes part of the first header's
  // name, so a column called "employee_code" silently fails to match.
  const input = text.replace(/^\uFEFF/, '');

  const table: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\r') {
      // Consume CRLF as one terminator.
      if (input[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      table.push(row);
      row = [];
      continue;
    }
    if (char === '\n') {
      row.push(field);
      field = '';
      table.push(row);
      row = [];
      continue;
    }
    field += char;
  }

  // Whatever is buffered when the input ends is the last field of the last row — unless the file
  // ended with a newline, in which case there is nothing pending and pushing would add a phantom
  // blank row.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    table.push(row);
  }

  const headerRow = table.shift() ?? [];
  const headers = headerRow.map((cell) => cell.trim());

  const rows: Array<Record<string, string>> = [];
  for (const cells of table) {
    // A trailing blank line, or a spacer row someone left in the sheet, is not a record.
    if (cells.every((cell) => cell.trim() === '')) continue;
    const record: Record<string, string> = {};
    headers.forEach((header, position) => {
      if (header) record[header] = (cells[position] ?? '').trim();
    });
    rows.push(record);
  }

  return { headers, rows };
}

/**
 * Reads a date from a sheet cell.
 *
 * Sheets hand back whatever the user's locale formats to, so DD/MM/YYYY and MM/DD/YYYY both occur
 * and are indistinguishable for the first twelve days of a month. Rather than guess, DD/MM is
 * assumed — the convention in this deployment's region — and the ambiguity is resolved in favour of
 * the unambiguous reading whenever the first component exceeds 12. The same rule
 * quality-data-mapper.ts already applies, kept identical so two importers cannot disagree about
 * what 03/04/2026 means.
 */
export function parseSheetDate(raw: string): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }

  const slashed = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (slashed) {
    let day = Number(slashed[1]);
    let month = Number(slashed[2]);
    // First component above 12 can only be a day, which settles the order regardless of locale.
    if (day <= 12 && month > 12) {
      [day, month] = [month, day];
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${slashed[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // A serial number is what a cell formatted as a date yields when published without formatting.
  const serial = Number(value);
  if (Number.isFinite(serial) && serial > 20_000 && serial < 60_000) {
    const millis = (serial - 25_569) * 86_400_000;
    return new Date(millis).toISOString().slice(0, 10);
  }

  return null;
}

/** Reads a numeric cell, tolerating the decoration spreadsheets add. */
export function parseSheetNumber(raw: string): number | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;

  // Strips thousands separators, currency symbols and a trailing percent sign. A percentage is
  // returned as the number as written (85% -> 85), because a KPI target for a percentage metric is
  // also written as 85, and converting to 0.85 here would make every such target wrong by 100x.
  const cleaned = value.replace(/[₹$€£,\s]/g, '').replace(/%$/, '');
  if (!cleaned || cleaned === '-') return null;

  // Duration cells (HH:MM:SS) are common for talk time and login hours. Converted to seconds, which
  // is the unit the operational metrics in this system already use.
  const duration = cleaned.match(/^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (duration) {
    return Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3] ?? 0);
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Validates a field's declared sheet column name. Sheets headers are free text, so this is lax. */
export function assertSheetColumn(name: string, label: string): string {
  const value = String(name ?? '').trim();
  if (!value) throw new SheetUrlError(`${label} is required for a sheet source`);
  return value;
}

// Re-exported so the sources module can keep using one identifier guard for query-backed sources
// without importing two modules for it.
export { assertSafeIdentifier };
