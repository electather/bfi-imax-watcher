import { chromium, type Browser } from "playwright";
import type { Config } from "./types.js";

const CHALLENGE_TITLE = "Just a moment...";
const NAV_TIMEOUT_MS = 60_000;
const CHALLENGE_WAIT_MS = 30_000;
const CHALLENGE_POLL_MS = 1_000;
const NETWORK_IDLE_MS = 10_000;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

// Minimal stealth: hide the most common automation tell so the managed
// challenge is more likely to auto-clear for headless Chromium.
const STEALTH_INIT_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
`;

async function waitForChallengeToClear(
  page: import("playwright").Page,
): Promise<void> {
  const deadline = Date.now() + CHALLENGE_WAIT_MS;
  while (Date.now() < deadline) {
    const title = await page.title();
    if (title && title !== CHALLENGE_TITLE) {
      return;
    }
    await page.waitForTimeout(CHALLENGE_POLL_MS);
  }
  throw new Error(
    `Cloudflare challenge did not clear within ${CHALLENGE_WAIT_MS}ms.`,
  );
}

/**
 * Launch headless Chromium, load the target URL, wait for the Cloudflare
 * managed challenge to clear, and return the rendered HTML. Owns the entire
 * browser lifecycle and always closes it. Throws on navigation timeout or an
 * unresolved challenge so the caller can map the failure to "unknown".
 */
export async function fetchHtml(config: Config): Promise<string> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      headless: config.headless,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 800 },
      locale: "en-GB",
    });
    await context.addInitScript(STEALTH_INIT_SCRIPT);
    const page = await context.newPage();

    // "commit" resolves on the first response so a stalled challenge redirect
    // cannot hang navigation before we begin polling the title.
    await page.goto(config.targetUrl, {
      waitUntil: "commit",
      timeout: NAV_TIMEOUT_MS,
    });
    await waitForChallengeToClear(page);
    await page
      .waitForLoadState("networkidle", { timeout: NETWORK_IDLE_MS })
      .catch(() => undefined);

    return await page.content();
  } finally {
    await browser?.close();
  }
}
