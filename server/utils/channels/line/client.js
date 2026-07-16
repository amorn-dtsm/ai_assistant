/**
 * LINE Messaging API client — plain async functions over native fetch.
 * No external dependencies (no @line/bot-sdk, no node-fetch).
 *
 * Every request uses a 10-second AbortSignal timeout.
 * HTTP-level errors resolve (never throw) with {success: false, status, error}.
 * Only the 5-message-limit violation is an explicit throw.
 */

const LINE_API_BASE = "https://api.line.me";

const TIMEOUT_MS = 10_000;
const MAX_MESSAGES = 5;

/**
 * Build LINE text-message objects from an array of strings.
 * @param {string[]} texts
 * @returns {{type: "text", text: string}[]}
 */
function toTextMessages(texts) {
  return texts.map((t) => ({ type: "text", text: t }));
}

/**
 * Validate message count does not exceed LINE's hard cap.
 * @param {string[]} texts
 */
function validateMessageCount(texts) {
  if (texts.length > MAX_MESSAGES) {
    throw new Error(
      `LINE API allows a maximum of 5 messages per request (got ${texts.length})`
    );
  }
}

/**
 * Send a reply using the reply token obtained from a webhook event.
 *
 * @param {string} channelAccessToken
 * @param {string} replyToken
 * @param {string[]} texts — 1–5 text strings
 * @returns {Promise<{success: boolean, status?: number, error?: string}>}
 */
async function replyMessage(channelAccessToken, replyToken, texts) {
  validateMessageCount(texts);

  try {
    const res = await fetch(`${LINE_API_BASE}/v2/bot/message/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: toTextMessages(texts),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        success: false,
        status: res.status,
        error: body.message || `HTTP ${res.status}`,
      };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Proactively push a message to a user/group/room.
 *
 * @param {string} channelAccessToken
 * @param {string} to — user/group/room ID (U-/C-/R- prefix)
 * @param {string[]} texts — 1–5 text strings
 * @returns {Promise<{success: boolean, status?: number, error?: string}>}
 */
async function pushMessage(channelAccessToken, to, texts) {
  validateMessageCount(texts);

  try {
    const res = await fetch(`${LINE_API_BASE}/v2/bot/message/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({
        to,
        messages: toTextMessages(texts),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        success: false,
        status: res.status,
        error: body.message || `HTTP ${res.status}`,
      };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Verify channel credentials by fetching bot profile info.
 *
 * @param {string} channelAccessToken
 * @returns {Promise<{valid: boolean, basicId?: string, displayName?: string, error?: string}>}
 */
async function getBotInfo(channelAccessToken) {
  try {
    const res = await fetch(`${LINE_API_BASE}/v2/bot/info`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        valid: false,
        error: body.message || `HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    return {
      valid: true,
      basicId: data.basicId,
      displayName: data.displayName,
    };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

module.exports = {
  replyMessage,
  pushMessage,
  getBotInfo,
  LINE_API_BASE,
};
