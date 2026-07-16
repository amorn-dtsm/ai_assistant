// Mock TelegramAdapter's transitive dependencies
jest.mock("../../../utils/telegramBot", () => {
  const mockInstance = {
    start: jest.fn(),
    stop: jest.fn(),
    get isRunning() {
      return false;
    },
  };
  const MockService = jest.fn(() => mockInstance);
  MockService.verifyToken = jest.fn();
  MockService.bootIfActive = jest.fn().mockResolvedValue(undefined);
  return { TelegramBotService: MockService };
});

jest.mock("../../../endpoints/telegram", () => ({
  telegramEndpoints: jest.fn(),
}));

// Mock LineAdapter's transitive dependencies
jest.mock("../../../endpoints/channels/line", () => ({
  lineEndpoints: jest.fn(),
}));

jest.mock("../../../utils/channels/line/client", () => ({
  replyMessage: jest.fn(),
  pushMessage: jest.fn(),
  getBotInfo: jest.fn(),
}));

jest.mock("../../../utils/channels/line/signature", () => ({
  verifyLineSignature: jest.fn(),
  lineSignatureMiddleware: jest.fn(),
}));

const {
  CHANNELS,
  getAdapter,
  registerAllRoutes,
  bootAllIfActive,
} = require("../../../utils/channels");
const { TelegramAdapter } = require("../../../utils/channels/telegram");
const LineAdapter = require("../../../utils/channels/line");
const {
  validateAdapterShape,
} = require("../../../utils/channels/BaseChannelAdapter");

describe("Channel Registry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // (a) CHANNELS array contains TelegramAdapter and LineAdapter
  test("CHANNELS array contains TelegramAdapter and LineAdapter", () => {
    expect(CHANNELS).toContain(TelegramAdapter);
    expect(CHANNELS).toContain(LineAdapter);
  });

  // (a2) supportedTypes includes both telegram and line
  test("CHANNELS types are ['telegram', 'line']", () => {
    expect(CHANNELS.map((c) => c.type)).toEqual(["telegram", "line"]);
  });

  // (b) getAdapter returns same instance on repeated calls (singleton cache)
  test("getAdapter('telegram') returns same instance on repeated calls", () => {
    const a = getAdapter("telegram");
    const b = getAdapter("telegram");
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  // (c) getAdapter returns null for unknown type
  test("getAdapter('nope') returns null for unknown type", () => {
    expect(getAdapter("nope")).toBeNull();
  });

  // (d) registerAllRoutes calls each adapter's registerRoutes once
  test("registerAllRoutes calls each adapter's registerRoutes once", () => {
    const mockRouter = { get: jest.fn(), post: jest.fn() };
    registerAllRoutes(mockRouter);
    const { telegramEndpoints } = require("../../../endpoints/telegram");
    const { lineEndpoints } = require("../../../endpoints/channels/line");
    expect(telegramEndpoints).toHaveBeenCalledTimes(1);
    expect(telegramEndpoints).toHaveBeenCalledWith(mockRouter);
    expect(lineEndpoints).toHaveBeenCalledTimes(1);
    expect(lineEndpoints).toHaveBeenCalledWith(mockRouter);
  });

  // (e) bootAllIfActive isolates failures via Promise.allSettled
  test("bootAllIfActive isolates adapter failures — resolves + logs error", async () => {
    const { TelegramBotService } = require("../../../utils/telegramBot");
    TelegramBotService.bootIfActive.mockRejectedValueOnce(
      new Error("Telegram exploded")
    );

    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    // Must resolve despite adapter failure
    await bootAllIfActive();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[ChannelBoot]"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });

  // (f) every CHANNELS entry passes validateAdapterShape
  test("every CHANNELS entry passes validateAdapterShape", () => {
    for (const AdapterClass of CHANNELS) {
      expect(() => validateAdapterShape(AdapterClass)).not.toThrow();
    }
  });
});
