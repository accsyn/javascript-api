const DATE_RE = /^[0-9]{2,4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$/;
const DATE_MS_RE = /^[0-9]{2,4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$/;

/** Serialize a value the way the Python API JSONEncoder does. */
export function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (nested instanceof Date) {
      return nested.toISOString().replace(/\.\d{3}Z$/, "");
    }
    return nested;
  });
}

function parseUtcDate(value: string, withMillis: boolean): Date {
  const [datePart, timePart] = value.split("T");
  const [yearRaw, monthRaw, dayRaw] = datePart.split("-");
  let year = Number(yearRaw);
  if (yearRaw.length === 2) {
    year += year >= 69 ? 1900 : 2000;
  }
  const [hour, minute, secondAndMs] = timePart.split(":");
  const [second, millis] = withMillis ? secondAndMs.split(".") : [secondAndMs, "0"];
  return new Date(Date.UTC(year, Number(monthRaw) - 1, Number(dayRaw), Number(hour), Number(minute), Number(second), Number(millis)));
}

function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => decodeValue(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const decoded: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      decoded[key] = decodeValue(record[key]);
    }
    return decoded;
  }
  if (typeof value === "string") {
    if (value.startsWith("ObjectId:")) {
      return value.replace("ObjectId:", "");
    }
    if (DATE_RE.test(value)) {
      return parseUtcDate(value, false);
    }
    if (DATE_MS_RE.test(value)) {
      return parseUtcDate(value, true);
    }
  }
  return value;
}

/** Parse a backend JSON payload, converting accsyn timestamps to Date objects. */
export function parseJson(text: string): unknown {
  return decodeValue(JSON.parse(text));
}

export function estimateSize(value: unknown): number {
  if (value == null) {
    return 0;
  }
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + estimateSize(item), 0);
  }
  if (value instanceof Date) {
    return 19;
  }
  if (typeof value === "object") {
    let total = 0;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      total += key.length + estimateSize(child);
    }
    return total;
  }
  if (typeof value === "string") {
    return value.length;
  }
  return 10;
}
