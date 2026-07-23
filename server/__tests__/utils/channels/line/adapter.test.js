process.env.NODE_ENV = "test";

const {
  validateAdapterShape,
} = require("../../../../utils/channels/BaseChannelAdapter");

// --- Mock client ---
const mockReplyMessage = jest.fn();
const mockPushMessage = jest.fn();
const mockGetBotInfo = jest.fn();
jest.mock("../../../../utils/channels/line/client", () => ({
  replyMessage: (...args) => mockReplyMessage(...args),
  pushMessage: (...args) => mockPushMessage(...args),
  getBotInfo: (...args) => mockGetBotInfo(...args),
}));

// --- Mock ApiChatHandler ---
const mockChatSync = jest.fn();
jest.mock("../../../../utils/chats/apiChatHandler", () => ({
  ApiChatHandler: {
    chatSync: (...args) => mockChatSync(...args),
  },
}));

// --- Mock Workspace model ---
const mockWorkspaceGet = jest.fn();
const mockWorkspaceWhere = jest.fn();
jest.mock("../../../../models/workspace", () => ({
  Workspace: {
    get: (...args) => mockWorkspaceGet(...args),
    where: (...args) => mockWorkspaceWhere(...args),
  },
}));

// --- Mock ExternalCommunicationConnector ---
const mockConnectorGet = jest.fn();
jest.mock("../../../../models/externalCommunicationConnector", () => ({
  ExternalCommunicationConnector: {
    get: (...args) => mockConnectorGet(...args),
  },
}));

// --- Mock crypto ---
jest.mock("../../../../utils/channels/crypto", () => ({
  decryptCredential: (v) => `decrypted:${v}`,
}));

// --- Fixture IDs ---
const USER_ID = "Uabcdef1234567890abcdef1234567890";
const GROUP_ID = "Cabcdef1234567890abcdef1234567890";
const ROOM_ID = "Rabcdef1234567890abcdef1234567890";
const REPLY_TOKEN = "test-reply-token-abc123";
const ACCESS_TOKEN = "test-access-token";

// --- Helpers ---
function makeTextEvent(sourceId, overrides = {}) {
  const sourceType = sourceId.startsWith("U")
    ? "user"
    : sourceId.startsWith("C")
      ? "group"
      : "room";
  const source = { type: sourceType, userId: sourceId };
  if (sourceType === "group") source.groupId = sourceId;
  if (sourceType === "room") source.roomId = sourceId;

  return {
    type: "message",
    replyToken: REPLY_TOKEN,
    timestamp: Date.now(),
    source,
    message: { type: "text", text: "Hello bot" },
    ...overrides,
  };
}

function makeImageEvent(sourceId) {
  return {
    type: "message",
    replyToken: REPLY_TOKEN,
    timestamp: Date.now(),
    source: { type: "user", userId: sourceId },
    message: { type: "image", id: "img-123" },
  };
}

// --- Workspace fixture ---
const MOCK_WORKSPACE = { id: 1, slug: "test-ws", chatMode: "automatic" };

let LineAdapter;

beforeAll(() => {
  LineAdapter = require("../../../../utils/channels/line/index");
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default: connector has allowlisted user + group, workspace slug
  mockConnectorGet.mockResolvedValue({
    type: "line",
    active: true,
    config: {
      channel_access_token: "enc:token123",
      channel_secret: "enc:secret123",
      default_workspace: "test-ws",
      allow_users: [USER_ID],
      allow_groups: [GROUP_ID],
      allow_rooms: [ROOM_ID],
    },
  });
  mockWorkspaceGet.mockResolvedValue(MOCK_WORKSPACE);
  mockWorkspaceWhere.mockResolvedValue([MOCK_WORKSPACE]);
  mockChatSync.mockResolvedValue({ textResponse: "Bot reply text" });
  mockReplyMessage.mockResolvedValue({ success: true });
  mockPushMessage.mockResolvedValue({ success: true });
  mockGetBotInfo.mockResolvedValue({
    valid: true,
    basicId: "@bot123",
    displayName: "TestBot",
  });
});

describe("LineAdapter", () => {
  // ── (a) Shape validation ──
  describe("adapter shape", () => {
    it("passes validateAdapterShape", () => {
      expect(() => validateAdapterShape(LineAdapter)).not.toThrow();
    });

    it("has type='line'", () => {
      expect(LineAdapter.type).toBe("line");
    });

    it("has deliveryMode='webhook'", () => {
      expect(LineAdapter.deliveryMode).toBe("webhook");
    });

    it("has supportsPairing=false", () => {
      expect(LineAdapter.supportsPairing).toBe(false);
    });

    it("has correct credentialsSchema", () => {
      expect(LineAdapter.credentialsSchema).toEqual({
        channel_access_token: {
          required: true,
          description: expect.any(String),
        },
        channel_secret: { required: true, description: expect.any(String) },
      });
    });
  });

  // ── (b) Text message from allowlisted user → chatSync + reply ──
  describe("handleWebhookEvents — allowlisted user text message", () => {
    it("calls chatSync and replyMessage with chunked text", async () => {
      const adapter = new LineAdapter();
      adapter._accessToken = ACCESS_TOKEN;
      adapter._config = {
        allow_users: [USER_ID],
        allow_groups: [GROUP_ID],
        allow_rooms: [],
        default_workspace: "test-ws",
      };

      const event = makeTextEvent(USER_ID);
      await adapter.handleWebhookEvents([event]);

      // Wait for fire-and-forget
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChatSync).toHaveBeenCalledTimes(1);
      const chatArgs = mockChatSync.mock.calls[0][0];
      expect(chatArgs.workspace).toEqual(MOCK_WORKSPACE);
      expect(chatArgs.message).toBe("Hello bot");
      expect(chatArgs.sessionId).toBe(`line:${USER_ID}`);
      expect(chatArgs.mode).toBeNull();
      expect(chatArgs.user).toBeNull();
      expect(chatArgs.thread).toBeNull();
      expect(chatArgs.attachments).toEqual([]);

      expect(mockReplyMessage).toHaveBeenCalled();
    });
  });

  // ── (c) Non-allowlisted user → NO chatSync ──
  describe("handleWebhookEvents — non-allowlisted user", () => {
    it("does not call chatSync and logs warning", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      const adapter = new LineAdapter();
      adapter._accessToken = ACCESS_TOKEN;
      adapter._config = {
        allow_users: [], // user NOT in allow_users
        allow_groups: [GROUP_ID],
        allow_rooms: [],
        default_workspace: "test-ws",
      };

      const event = makeTextEvent(USER_ID);
      await adapter.handleWebhookEvents([event]);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChatSync).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("LINE user not in allowlist")
      );

      consoleSpy.mockRestore();
    });
  });

  // ── (d) Group message from allowlisted group → processed with sessionId ──
  describe("handleWebhookEvents — allowlisted group message", () => {
    it("processes group message with sessionId 'line:C...'", async () => {
      const adapter = new LineAdapter();
      adapter._accessToken = ACCESS_TOKEN;
      adapter._config = {
        allow_users: [USER_ID],
        allow_groups: [GROUP_ID],
        allow_rooms: [],
        default_workspace: "test-ws",
      };

      const event = makeTextEvent(GROUP_ID);
      await adapter.handleWebhookEvents([event]);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChatSync).toHaveBeenCalledTimes(1);
      expect(mockChatSync.mock.calls[0][0].sessionId).toBe(
        `line:${GROUP_ID}`
      );
    });
  });

  // ── (e) Elapsed >50s → pushMessage used, replyMessage NOT called ──
  describe("handleWebhookEvents — reply token expired (>50s)", () => {
    it("uses pushMessage instead of replyMessage", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      const adapter = new LineAdapter();
      adapter._accessToken = ACCESS_TOKEN;
      adapter._config = {
        allow_users: [USER_ID],
        allow_groups: [],
        allow_rooms: [],
        default_workspace: "test-ws",
      };

      // Event timestamp 60 seconds ago
      const event = makeTextEvent(USER_ID, {
        timestamp: Date.now() - 60_000,
      });
      await adapter.handleWebhookEvents([event]);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockReplyMessage).not.toHaveBeenCalled();
      expect(mockPushMessage).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("LINE push fallback used")
      );

      consoleSpy.mockRestore();
    });
  });

  // ── (f) Reply fails → automatic push fallback ──
  describe("handleWebhookEvents — reply failure triggers push fallback", () => {
    it("falls back to pushMessage when replyMessage returns success:false", async () => {
      mockReplyMessage.mockResolvedValue({
        success: false,
        error: "Invalid reply token",
      });

      const adapter = new LineAdapter();
      adapter._accessToken = ACCESS_TOKEN;
      adapter._config = {
        allow_users: [USER_ID],
        allow_groups: [],
        allow_rooms: [],
        default_workspace: "test-ws",
      };

      const event = makeTextEvent(USER_ID);
      await adapter.handleWebhookEvents([event]);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockReplyMessage).toHaveBeenCalledTimes(1);
      expect(mockPushMessage).toHaveBeenCalled();
    });
  });

  // ── (g) Non-text message → fixed fallback reply, NO chatSync ──
  describe("handleWebhookEvents — non-text message", () => {
    it("sends fixed fallback reply and skips chatSync", async () => {
      const adapter = new LineAdapter();
      adapter._accessToken = ACCESS_TOKEN;
      adapter._config = {
        allow_users: [USER_ID],
        allow_groups: [],
        allow_rooms: [],
        default_workspace: "test-ws",
      };

      const event = makeImageEvent(USER_ID);
      await adapter.handleWebhookEvents([event]);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChatSync).not.toHaveBeenCalled();
      // Should send the fixed fallback text
      const sentTexts =
        mockReplyMessage.mock.calls[0]?.[2] ||
        mockPushMessage.mock.calls[0]?.[2];
      expect(sentTexts).toContain(
        "Sorry, I can only process text messages right now."
      );
    });
  });

  // ── (h) verifyCredentials → getBotInfo ──
  describe("verifyCredentials", () => {
    it("calls getBotInfo and resolves on valid", async () => {
      await expect(
        LineAdapter.verifyCredentials({
          channel_access_token: ACCESS_TOKEN,
          channel_secret: "secret",
        })
      ).resolves.not.toThrow();
      expect(mockGetBotInfo).toHaveBeenCalledWith(ACCESS_TOKEN);
    });

    it("throws on invalid credentials", async () => {
      mockGetBotInfo.mockResolvedValue({ valid: false, error: "Unauthorized" });
      await expect(
        LineAdapter.verifyCredentials({
          channel_access_token: "bad-token",
          channel_secret: "secret",
        })
      ).rejects.toThrow(/Unauthorized/);
    });
  });

  // ── (i) start/stop ──
  describe("start and stop", () => {
    it("start decrypts credentials and sets isRunning=true", async () => {
      const adapter = new LineAdapter();
      await adapter.start({
        channel_access_token: "enc:tok",
        channel_secret: "enc:sec",
        default_workspace: "test-ws",
        allow_users: [USER_ID],
        allow_groups: [],
        allow_rooms: [],
      });

      expect(adapter.isRunning).toBe(true);
    });

    it("stop sets isRunning=false", async () => {
      const adapter = new LineAdapter();
      await adapter.start({
        channel_access_token: "enc:tok",
        channel_secret: "enc:sec",
        default_workspace: "test-ws",
        allow_users: [USER_ID],
        allow_groups: [],
        allow_rooms: [],
      });
      expect(adapter.isRunning).toBe(true);

      await adapter.stop();
      expect(adapter.isRunning).toBe(false);
    });
  });

  // ── Extra: getChannelSecret returns decrypted secret ──
  describe("getChannelSecret", () => {
    it("returns decrypted channel_secret from config", async () => {
      const adapter = new LineAdapter();
      await adapter.start({
        channel_access_token: "enc:tok",
        channel_secret: "enc:sec",
        default_workspace: "test-ws",
        allow_users: [],
        allow_groups: [],
        allow_rooms: [],
      });
      const secret = adapter.getChannelSecret();
      expect(secret).toBe("decrypted:enc:sec");
    });
  });

  // ── configUpdateSchema ──
  describe("configUpdateSchema", () => {
    it("defines allow_users, allow_groups, allow_rooms, default_workspace", () => {
      expect(LineAdapter.configUpdateSchema).toEqual({
        allow_users: { type: "array", itemPrefix: "U" },
        allow_groups: { type: "array", itemPrefix: "C" },
        allow_rooms: { type: "array", itemPrefix: "R" },
        default_workspace: { type: "string" },
      });
    });
  });

  // ── Cross-list isolation ──
  describe("allowlist cross-list isolation", () => {
    it("user ID in allow_groups does NOT allow a user-type message", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      const adapter = new LineAdapter();
      adapter._accessToken = ACCESS_TOKEN;
      adapter._config = {
        allow_users: [], // USER_ID NOT here
        allow_groups: [USER_ID], // USER_ID in groups list (wrong list)
        allow_rooms: [],
        default_workspace: "test-ws",
      };

      // Event source.type = "user" but ID is only in allow_groups
      const event = makeTextEvent(USER_ID);
      await adapter.handleWebhookEvents([event]);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChatSync).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("LINE user not in allowlist")
      );
      consoleSpy.mockRestore();
    });

    it("group ID in allow_users does NOT allow a group-type message", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      const adapter = new LineAdapter();
      adapter._accessToken = ACCESS_TOKEN;
      adapter._config = {
        allow_users: [GROUP_ID], // GROUP_ID in users list (wrong list)
        allow_groups: [], // GROUP_ID NOT here
        allow_rooms: [],
        default_workspace: "test-ws",
      };

      const event = makeTextEvent(GROUP_ID);
      await adapter.handleWebhookEvents([event]);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChatSync).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("LINE user not in allowlist")
      );
      consoleSpy.mockRestore();
    });

    it("room message checks allow_rooms list", async () => {
      const adapter = new LineAdapter();
      adapter._accessToken = ACCESS_TOKEN;
      adapter._config = {
        allow_users: [],
        allow_groups: [],
        allow_rooms: [ROOM_ID],
        default_workspace: "test-ws",
      };

      const event = makeTextEvent(ROOM_ID);
      await adapter.handleWebhookEvents([event]);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChatSync).toHaveBeenCalledTimes(1);
      expect(mockChatSync.mock.calls[0][0].sessionId).toBe(
        `line:${ROOM_ID}`
      );
    });
  });
});
