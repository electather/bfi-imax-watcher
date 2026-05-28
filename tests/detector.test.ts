import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_DETECTOR_CONFIG, detect } from "../src/detector.js";

function fixture(name: string): string {
  return readFileSync(resolve(import.meta.dirname, "fixtures", name), "utf8");
}

describe("detect", () => {
  it("classifies the coming-soon fixture as coming_soon (TEST-001)", () => {
    expect(detect(fixture("coming_soon.html"), DEFAULT_DETECTOR_CONFIG)).toBe(
      "coming_soon",
    );
  });

  it("classifies the bookable fixture as bookable (TEST-002)", () => {
    expect(detect(fixture("bookable.html"), DEFAULT_DETECTOR_CONFIG)).toBe(
      "bookable",
    );
  });

  it("treats garbage HTML as unknown (TEST-003)", () => {
    expect(
      detect("<html><body>hello</body></html>", DEFAULT_DETECTOR_CONFIG),
    ).toBe("unknown");
  });

  it("treats the Cloudflare interstitial as unknown (TEST-003)", () => {
    const interstitial =
      "<html><head><title>Just a moment...</title></head><body>" +
      "Enable JavaScript and cookies to continue. challenges.cloudflare.com" +
      "</body></html>";
    expect(detect(interstitial, DEFAULT_DETECTOR_CONFIG)).toBe("unknown");
  });

  it("ignores stale coming-soon text when a booking link is present", () => {
    const html =
      "<html><body>Tickets on sale soon" +
      '<a href="/imax/Online/mapSelect.asp?performance=1">Buy tickets</a>' +
      "</body></html>";
    expect(detect(html, DEFAULT_DETECTOR_CONFIG)).toBe("bookable");
  });
});
