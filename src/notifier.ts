import type { Config } from "./types.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";

/** POST a message to the Telegram Bot API; throws on a non-2xx response. */
async function send(config: Config, text: string): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) {
    throw new Error("Telegram credentials are not configured.");
  }

  const url = `${TELEGRAM_API_BASE}/bot${config.telegramBotToken}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.telegramChatId,
      text,
      disable_web_page_preview: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Telegram sendMessage failed: ${response.status} ${response.statusText} ${body}`.trim(),
    );
  }
}

/** Send the "tickets are now bookable" alert. */
export function sendAlert(config: Config, text: string): Promise<void> {
  return send(config, text);
}

/** Send a silent-breakage error alert. */
export function sendError(config: Config, text: string): Promise<void> {
  return send(config, `⚠️ ${text}`);
}
