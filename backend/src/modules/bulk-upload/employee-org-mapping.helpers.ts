/**
 * Pure helpers for the Employee Process / Cost Centre / LOB Mapping uploader
 * (employee-lob-bulk.service.ts): chunking, code normalisation and code-or-name resolution
 * against an in-memory master. No I/O here.
 */
import type { RowDataPacket } from "mysql2";

export interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown> | null;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

export const norm = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toUpperCase();

export const marks = (n: number): string => Array(n).fill("?").join(",");

export function parseData(
  raw: BatchRow["normalized_data"],
): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) ?? {};
    } catch {
      return {};
    }
  }
  return raw ?? {};
}

/** A master row addressable by its code and by its name. */
export interface Refable {
  code: string;
  name: string;
}

export interface RefIndex<T extends Refable> {
  byCode: Map<string, T>;
  byName: Map<string, T[]>;
}

export function buildRefIndex<T extends Refable>(items: T[]): RefIndex<T> {
  const byCode = new Map<string, T>();
  const byName = new Map<string, T[]>();
  for (const item of items) {
    const codeKey = norm(item.code);
    if (codeKey && !byCode.has(codeKey)) byCode.set(codeKey, item);
    const nameKey = norm(item.name);
    if (!nameKey) continue;
    const list = byName.get(nameKey);
    if (list) list.push(item);
    else byName.set(nameKey, [item]);
  }
  return { byCode, byName };
}

export type ResolvedRef<T> =
  | { kind: "found"; item: T }
  | { kind: "ambiguous"; count: number }
  | { kind: "missing" };

/**
 * A code always wins. Otherwise the value is treated as a name, which is accepted only when
 * exactly one master row carries it — a shared name never silently picks one.
 */
export function resolveRef<T extends Refable>(
  index: RefIndex<T>,
  ref: string,
): ResolvedRef<T> {
  const key = norm(ref);
  const byCode = index.byCode.get(key);
  if (byCode) return { kind: "found", item: byCode };
  const named = index.byName.get(key) ?? [];
  if (named.length === 1) return { kind: "found", item: named[0] };
  if (named.length > 1) return { kind: "ambiguous", count: named.length };
  return { kind: "missing" };
}
