import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAlert, sendError } from "../src/notifier.js";
import type { Config } from "../src/types.js";

const config: Config = {
  telegramBotToken: "test-token",
  telegramChatId: "123456",
  targetUrl: "https://example.com",
  checkIntervalSeconds: 900,
  headless: true,
  errorAlertAfter: 5,
  stateFile: "/tmp/last_status.json",
  detector: {
    bookableKeywords: [],
    comingSoonKeywords: [],
    bookingLinkPatterns: [],
  },
};

function mockFetch(status: number): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() =>
    Promise.resolve(new Response(status === 200 ? "ok" : "error", { status })),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("notifier", () => {
  it("resolves and posts to the Telegram API on a 2xx response (TEST-005)", async () => {
    const fetchFn = mockFetch(200);
    await expect(
      sendAlert(config, "tickets are bookable"),
    ).resolves.toBeUndefined();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as {
      chat_id: string;
      text: string;
    };
    expect(body.chat_id).toBe("123456");
    expect(body.text).toContain("tickets are bookable");
  });

  it("throws on a non-2xx response (TEST-005)", async () => {
    mockFetch(403);
    await expect(sendAlert(config, "nope")).rejects.toThrow(/403/);
  });

  it("prefixes error alerts with a warning marker", async () => {
    const fetchFn = mockFetch(200);
    await sendError(config, "5 consecutive failures");
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text).toContain("⚠️");
  });

  it("throws when credentials are missing", async () => {
    mockFetch(200);
    const noCreds: Config = { ...config, telegramBotToken: "" };
    await expect(sendAlert(noCreds, "x")).rejects.toThrow(/credentials/i);
  });
});
