const { BaseChannelAdapter } = require("../BaseChannelAdapter");
const { decryptCredential } = require("../crypto");
const {
  stripMarkdownForLine,
  splitForLine,
  batchMessages,
} = require("./format");
const { replyMessage, pushMessage, getBotInfo } = require("./client");

const REPLY_TOKEN_TTL_MS = 50_000; // 50 seconds
const NON_TEXT_FALLBACK = "Sorry, I can only process text messages right now.";

/**
 * LINE Messaging channel adapter.
 * Transport-only — delegates chat processing to ApiChatHandler.chatSync.
 */
class LineAdapter extends BaseChannelAdapter {
  static type = "line";
  static deliveryMode = "webhook";
  static supportsPairing = false;
  static credentialsSchema = {
    channel_access_token: {
      required: true,
      description: "LINE channel access token",
    },
    channel_secret: {
      required: true,
      description: "LINE channel secret for webhook signature verification",
    },
  };

  static configUpdateSchema = {
    allow_users: { type: "array", itemPrefix: "U" },
    allow_groups: { type: "array", itemPrefix: "C" },
    allow_rooms: { type: "array", itemPrefix: "R" },
    default_workspace: { type: "string" },
  };

  /** @type {string|null} Decrypted channel access token */
  _accessToken = null;

  /** @type {string|null} Decrypted channel secret */
  _channelSecret = null;

  /** @type {object|null} Adapter config (allow_users, allow_groups, allow_rooms, default_workspace, etc.) */
  _config = null;

  /** @type {boolean} */
  _running = false;

  // ── Statics ──

  /**
   * Resume from DB on server boot — if the connector is active, start
   * the singleton adapter so webhook requests can be processed.
   */
  static async bootIfActive() {
    const {
      ExternalCommunicationConnector,
    } = require("../../../models/externalCommunicationConnector");
    const { getAdapter } = require("../index");

    const connector = await ExternalCommunicationConnector.get("line");
    if (!connector || !connector.active) return;

    const adapter = getAdapter("line");
    if (adapter && !adapter.isRunning) {
      await adapter.start(connector.config);
      console.log("[LINE] LINE adapter booted from stored config");
    }
  }

  /**
   * Verify LINE credentials by calling the bot info endpoint.
   * @param {{channel_access_token: string, channel_secret: string}} creds
   */
  static async verifyCredentials(creds) {
    const result = await getBotInfo(creds.channel_access_token);
    if (!result.valid) {
      throw new Error(result.error || "Invalid LINE credentials");
    }
    return result;
  }

  // ── Instance lifecycle ──

  get isRunning() {
    return this._running;
  }

  /**
   * Start the adapter — decrypt stored credentials and mark running.
   * @param {object} config
   */
  async start(config) {
    this._accessToken = decryptCredential(config.channel_access_token);
    this._channelSecret = decryptCredential(config.channel_secret);
    this._config = config;
    this._running = true;
  }

  async stop() {
    this._running = false;
    this._accessToken = null;
    this._channelSecret = null;
    this._config = null;
  }

  /**
   * Mount LINE webhook and admin endpoints on the given router.
   * @param {import('express').Router} router
   */
  registerRoutes(router) {
    const { lineEndpoints } = require("../../../endpoints/channels/line");
    lineEndpoints(router);
  }

  /**
   * Return the decrypted channel secret (for signature middleware).
   * @returns {string|null}
   */
  getChannelSecret() {
    return this._channelSecret;
  }

  // ── Webhook processing ──

  /**
   * Process LINE webhook events. Ack-first: processing is fire-and-forget.
   * @param {object[]} events - LINE webhook event array
   */
  handleWebhookEvents(events) {
    // Fire-and-forget — caller can await for the ack, processing runs async.
    const promise = this._processEvents(events).catch((err) => {
      console.error("[LINE] Event processing error:", err.message);
    });

    // Return the promise so tests can await it, but webhook handler won't.
    return promise;
  }

  /**
   * Internal: process all events sequentially.
   * @param {object[]} events
   */
  async _processEvents(events) {
    for (const event of events) {
      if (event.type !== "message") continue;
      await this._handleMessageEvent(event);
    }
  }

  /**
   * Handle a single message event.
   * @param {object} event
   */
  async _handleMessageEvent(event) {
    const sourceId = this._getSourceId(event);
    const sourceType = event.source?.type;

    // Allowlist check — separate lists per source type
    if (!this._isAllowlisted(sourceId, sourceType)) {
      console.log(`[LINE] LINE user not in allowlist: ${sourceId}`);
      return;
    }

    // Non-text message → fixed fallback
    if (event.message?.type !== "text") {
      await this._sendReply(event, sourceId, [NON_TEXT_FALLBACK]);
      return;
    }

    // Resolve workspace
    const workspace = await this._resolveWorkspace();
    if (!workspace) {
      console.error("[LINE] No workspace found for LINE adapter");
      return;
    }

    // Call chatSync
    const { ApiChatHandler } = require("../../chats/apiChatHandler");
    const { textResponse } = await ApiChatHandler.chatSync({
      workspace,
      message: event.message.text,
      mode: null,
      user: null,
      thread: null,
      sessionId: `line:${sourceId}`,
      attachments: [],
      reset: false,
    });

    // Format and send response
    if (textResponse) {
      const plain = stripMarkdownForLine(textResponse);
      const chunks = splitForLine(plain);
      const batches = batchMessages(chunks);

      for (const batch of batches) {
        await this._sendReply(event, sourceId, batch);
      }
    }
  }

  /**
   * Send reply via reply token or push fallback.
   * @param {object} event - Original webhook event
   * @param {string} sourceId - User/group/room ID
   * @param {string[]} texts - 1-5 text strings
   */
  async _sendReply(event, sourceId, texts) {
    const elapsed = Date.now() - event.timestamp;

    // If reply token is expired, go straight to push
    if (elapsed > REPLY_TOKEN_TTL_MS) {
      console.log("[LINE] LINE push fallback used — reply token expired");
      await pushMessage(this._accessToken, sourceId, texts);
      return;
    }

    // Try reply first
    const result = await replyMessage(
      this._accessToken,
      event.replyToken,
      texts
    );

    // If reply failed, fall back to push
    if (!result.success) {
      console.log(
        "[LINE] LINE push fallback used — reply failed:",
        result.error
      );
      await pushMessage(this._accessToken, sourceId, texts);
    }
  }

  /**
   * Check if source is in the correct allowlist for its type.
   * @param {string} sourceId
   * @param {string} sourceType - "user", "group", or "room"
   * @returns {boolean}
   */
  _isAllowlisted(sourceId, sourceType) {
    const cfg = this._config || {};
    if (sourceType === "group")
      return (cfg.allow_groups || []).includes(sourceId);
    if (sourceType === "room")
      return (cfg.allow_rooms || []).includes(sourceId);
    return (cfg.allow_users || []).includes(sourceId);
  }

  /**
   * Extract the source ID (userId, groupId, or roomId) from event.
   * @param {object} event
   * @returns {string}
   */
  _getSourceId(event) {
    const source = event.source || {};
    if (source.type === "group") return source.groupId;
    if (source.type === "room") return source.roomId;
    return source.userId;
  }

  /**
   * Resolve workspace from config — mirrors Telegram connect pattern.
   * @returns {Promise<object|null>}
   */
  async _resolveWorkspace() {
    const { Workspace } = require("../../../models/workspace");
    const slug = this._config?.default_workspace;

    if (slug) {
      const ws = await Workspace.get({ slug });
      if (ws) return ws;
    }

    // Fallback: first workspace
    const workspaces = await Workspace.where({}, 1);
    if (workspaces && workspaces.length) return workspaces[0];

    return null;
  }
}

module.exports = LineAdapter;
