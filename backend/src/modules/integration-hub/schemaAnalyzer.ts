export interface DetectedField {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "unknown";
  nullable: boolean;
  sample_values: unknown[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/;

function detectType(value: unknown): DetectedField["type"] {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (DATE_RE.test(value.trim())) return "date";
    return "string";
  }
  return "unknown";
}

export function analyzeSchema(rows: Record<string, unknown>[]): DetectedField[] {
  if (rows.length === 0) return [];

  const fieldMap = new Map<string, { types: Set<string>; samples: unknown[]; presentCount: number }>();

  for (const row of rows) {
    for (const [key, val] of Object.entries(row)) {
      if (!fieldMap.has(key)) {
        fieldMap.set(key, { types: new Set(), samples: [], presentCount: 0 });
      }
      const entry = fieldMap.get(key)!;
      entry.presentCount++;
      const t = detectType(val);
      if (t !== "unknown") entry.types.add(t);
      if (entry.samples.length < 3 && val !== null && val !== undefined) {
        entry.samples.push(val);
      }
    }
  }

  const total = rows.length;
  const result: DetectedField[] = [];

  for (const [name, { types, samples, presentCount }] of fieldMap) {
    let type: DetectedField["type"] = "unknown";
    if (types.has("date"))    type = "date";
    else if (types.has("number"))  type = "number";
    else if (types.has("boolean")) type = "boolean";
    else if (types.has("string"))  type = "string";

    result.push({
      name,
      type,
      nullable: presentCount < total,
      sample_values: samples,
    });
  }

  return result;
}
