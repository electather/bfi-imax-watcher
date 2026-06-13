import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface StoredState {
  /** Keys of watched showtimes already alerted while currently bookable. */
  alerted: string[];
  updatedAt: string;
}

/**
 * Read the set of showtime keys we have already alerted on (and that were still
 * bookable as of the last write). Returns an empty set when the file is
 * missing, unreadable, not valid JSON, or malformed, so the caller treats any
 * of those as "nothing alerted yet".
 */
export function readAlerted(file: string): Set<string> {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return new Set();
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "alerted" in parsed &&
      Array.isArray((parsed as StoredState).alerted)
    ) {
      const keys = (parsed as StoredState).alerted.filter(
        (key): key is string => typeof key === "string",
      );
      return new Set(keys);
    }
  } catch {
    return new Set();
  }
  return new Set();
}

/**
 * Persist the set of currently-bookable, already-alerted showtime keys as JSON,
 * creating the parent directory if needed. Keys are sorted for stable diffs.
 */
export function writeAlerted(file: string, keys: ReadonlySet<string>): void {
  mkdirSync(dirname(file), { recursive: true });
  const payload: StoredState = {
    alerted: [...keys].sort(),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
