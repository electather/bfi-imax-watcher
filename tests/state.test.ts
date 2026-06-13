import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAlerted, writeAlerted } from "../src/state.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bfi-state-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("state", () => {
  it("writes then reads back the same alerted keys", () => {
    const file = join(dir, "state.json");
    writeAlerted(file, new Set(["2026-05-28T11:30", "2026-05-28T17:40"]));
    expect(readAlerted(file)).toEqual(
      new Set(["2026-05-28T11:30", "2026-05-28T17:40"]),
    );
  });

  it("round-trips an empty set", () => {
    const file = join(dir, "empty.json");
    writeAlerted(file, new Set());
    expect(readAlerted(file)).toEqual(new Set());
  });

  it("creates missing parent directories on write", () => {
    const file = join(dir, "nested", "deeper", "state.json");
    writeAlerted(file, new Set(["2026-07-17T20:15"]));
    expect(readAlerted(file)).toEqual(new Set(["2026-07-17T20:15"]));
  });

  it("returns an empty set for a missing file", () => {
    expect(readAlerted(join(dir, "does-not-exist.json"))).toEqual(new Set());
  });

  it("returns an empty set for a corrupt file", () => {
    const file = join(dir, "corrupt.json");
    writeFileSync(file, "{ not valid json", "utf8");
    expect(readAlerted(file)).toEqual(new Set());
  });

  it("returns an empty set when the JSON lacks an alerted array", () => {
    const file = join(dir, "wrong-shape.json");
    writeFileSync(file, JSON.stringify({ status: "bookable" }), "utf8");
    expect(readAlerted(file)).toEqual(new Set());
  });
});
