import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Status } from "./types.js";

interface StoredState {
  status: Status;
  updatedAt: string;
}

const VALID_STATUSES: readonly Status[] = [
  "bookable",
  "coming_soon",
  "unknown",
];

function isStatus(value: unknown): value is Status {
  return typeof value === "string" && VALID_STATUSES.includes(value as Status);
}

/**
 * Read the last persisted status. Returns null when the file is missing,
 * unreadable, not valid JSON, or does not contain a recognised status, so the
 * caller can treat any of those as "no prior state".
 */
export function readStatus(file: string): Status | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "status" in parsed) {
      const { status } = parsed;
      if (isStatus(status)) {
        return status;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Persist the current status as JSON, creating the parent directory if needed.
 */
export function writeStatus(file: string, status: Status): void {
  mkdirSync(dirname(file), { recursive: true });
  const payload: StoredState = {
    status,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
