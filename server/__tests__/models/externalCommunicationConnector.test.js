jest.mock("../../utils/prisma", () => ({
  external_communication_connectors: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
}));

// Mock transitive deps of TelegramAdapter (loaded via channels registry)
jest.mock("../../utils/telegramBot", () => {
  const MockService = jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn(),
    get isRunning() {
      return false;
    },
  }));
  MockService.verifyToken = jest.fn();
  MockService.bootIfActive = jest.fn().mockResolvedValue(undefined);
  return { TelegramBotService: MockService };
});
jest.mock("../../endpoints/telegram", () => ({
  telegramEndpoints: jest.fn(),
}));

const {
  ExternalCommunicationConnector,
} = require("../../models/externalCommunicationConnector");
const prisma = require("../../utils/prisma");

describe("ExternalCommunicationConnector", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("supportedTypes", () => {
    test("is a computed getter, not a static array", () => {
      const descriptor = Object.getOwnPropertyDescriptor(
        ExternalCommunicationConnector,
        "supportedTypes"
      );
      expect(typeof descriptor.get).toBe("function");
    });

    test("deep-equals types from channel registry", () => {
      const { CHANNELS } = require("../../utils/channels");
      const expected = CHANNELS.map((c) => c.type);
      expect(ExternalCommunicationConnector.supportedTypes).toEqual(expected);
    });
  });

  describe("updateConfig", () => {
    test("preserves active flag (regression for 3-arg upsert bug)", async () => {
      // Existing connector with active=true
      prisma.external_communication_connectors.findUnique.mockResolvedValue({
        type: "telegram",
        config: JSON.stringify({ bot_token: "old-token" }),
        active: true,
      });

      prisma.external_communication_connectors.upsert.mockResolvedValue({
        type: "telegram",
        config: JSON.stringify({ bot_token: "new-token" }),
        active: true,
      });

      await ExternalCommunicationConnector.updateConfig("telegram", {
        bot_token: "new-token",
      });

      expect(
        prisma.external_communication_connectors.upsert
      ).toHaveBeenCalledTimes(1);
      const upsertArgs =
        prisma.external_communication_connectors.upsert.mock.calls[0][0];
      // After fix: active must be in the update payload
      expect(upsertArgs.update).toHaveProperty("active", true);
    });
  });
});
