import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStatus, writeStatus } from "../src/state.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bfi-state-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("state", () => {
  it("writes then reads back the same status (TEST-004)", () => {
    const file = join(dir, "last_status.json");
    writeStatus(file, "bookable");
    expect(readStatus(file)).toBe("bookable");
  });

  it("creates missing parent directories on write", () => {
    const file = join(dir, "nested", "deeper", "last_status.json");
    writeStatus(file, "coming_soon");
    expect(readStatus(file)).toBe("coming_soon");
  });

  it("returns null for a missing file (TEST-004)", () => {
    expect(readStatus(join(dir, "does-not-exist.json"))).toBeNull();
  });

  it("returns null for a corrupt file (TEST-004)", () => {
    const file = join(dir, "corrupt.json");
    writeFileSync(file, "{ not valid json", "utf8");
    expect(readStatus(file)).toBeNull();
  });

  it("returns null when the JSON lacks a valid status", () => {
    const file = join(dir, "wrong-shape.json");
    writeFileSync(file, JSON.stringify({ status: "nope" }), "utf8");
    expect(readStatus(file)).toBeNull();
  });
});
