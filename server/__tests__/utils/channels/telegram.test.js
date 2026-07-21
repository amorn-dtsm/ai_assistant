process.env.NODE_ENV = "test";

// Mock TelegramBotService — factory runs on first require (jest.mock is hoisted)
jest.mock("../../../utils/telegramBot", () => {
  const singleton = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    isRunning: false,
  };
  const MockService = jest.fn(() => singleton);
  MockService.verifyToken = jest
    .fn()
    .mockResolvedValue({ valid: true, username: "testbot", error: null });
  MockService.bootIfActive = jest.fn().mockResolvedValue(undefined);
  MockService._mockSingleton = singleton;
  return { TelegramBotService: MockService };
});

jest.mock("../../../endpoints/telegram", () => ({
  telegramEndpoints: jest.fn(),
}));

const { TelegramAdapter } = require("../../../utils/channels/telegram");
const {
  validateAdapterShape,
} = require("../../../utils/channels/BaseChannelAdapter");
const { TelegramBotService } = require("../../../utils/telegramBot");
const { telegramEndpoints } = require("../../../endpoints/telegram");

describe("TelegramAdapter", () => {
  const mockSingleton = TelegramBotService._mockSingleton;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSingleton.isRunning = false;
  });

  // (a) shape validation
  it("passes validateAdapterShape", () => {
    expect(() => validateAdapterShape(TelegramAdapter)).not.toThrow();
  });

  // (b) static fields
  it('static type is "telegram"', () => {
    expect(TelegramAdapter.type).toBe("telegram");
  });

  it('deliveryMode is "polling"', () => {
    expect(TelegramAdapter.deliveryMode).toBe("polling");
  });

  it("supportsPairing is true", () => {
    expect(TelegramAdapter.supportsPairing).toBe(true);
  });

  it("credentialsSchema declares bot_token as required", () => {
    expect(TelegramAdapter.credentialsSchema).toEqual({
      bot_token: {
        required: true,
        description: expect.any(String),
      },
    });
  });

  // (c) verifyCredentials delegates to TelegramBotService.verifyToken
  it("verifyCredentials delegates to TelegramBotService.verifyToken", async () => {
    const result = await TelegramAdapter.verifyCredentials({
      bot_token: "123:ABC",
    });
    expect(TelegramBotService.verifyToken).toHaveBeenCalledWith("123:ABC");
    expect(result).toEqual({ valid: true, username: "testbot", error: null });
  });

  // (d) start/stop delegate to singleton
  it("start(config) delegates to singleton start()", async () => {
    const adapter = new TelegramAdapter();
    const config = { bot_token: "abc", bot_username: "mybot" };
    await adapter.start(config);
    expect(mockSingleton.start).toHaveBeenCalledWith(config);
  });

  it("stop() delegates to singleton stop()", async () => {
    const adapter = new TelegramAdapter();
    await adapter.stop();
    expect(mockSingleton.stop).toHaveBeenCalled();
  });

  // (e) isRunning proxies singleton
  it("isRunning proxies singleton isRunning", () => {
    const adapter = new TelegramAdapter();
    expect(adapter.isRunning).toBe(false);
    mockSingleton.isRunning = true;
    expect(adapter.isRunning).toBe(true);
  });

  // (f) bootIfActive delegates
  it("static bootIfActive delegates to TelegramBotService.bootIfActive", async () => {
    await TelegramAdapter.bootIfActive();
    expect(TelegramBotService.bootIfActive).toHaveBeenCalledTimes(1);
  });

  // (g) registerRoutes calls telegramEndpoints exactly once
  it("registerRoutes calls telegramEndpoints(router) exactly once", () => {
    const adapter = new TelegramAdapter();
    const mockRouter = { get: jest.fn(), post: jest.fn() };
    adapter.registerRoutes(mockRouter);
    expect(telegramEndpoints).toHaveBeenCalledTimes(1);
    expect(telegramEndpoints).toHaveBeenCalledWith(mockRouter);
  });
});
