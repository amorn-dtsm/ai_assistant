process.env.NODE_ENV = "test";

const {
  BaseChannelAdapter,
  validateAdapterShape,
} = require("../../../utils/channels/BaseChannelAdapter");

describe("BaseChannelAdapter", () => {
  describe("static field defaults", () => {
    it("type defaults to null", () => {
      expect(BaseChannelAdapter.type).toBeNull();
    });

    it("deliveryMode defaults to 'polling'", () => {
      expect(BaseChannelAdapter.deliveryMode).toBe("polling");
    });

    it("supportsPairing defaults to false", () => {
      expect(BaseChannelAdapter.supportsPairing).toBe(false);
    });

    it("credentialsSchema defaults to empty object", () => {
      expect(BaseChannelAdapter.credentialsSchema).toEqual({});
    });
  });

  describe("instance methods", () => {
    let adapter;
    beforeEach(() => {
      adapter = new BaseChannelAdapter();
    });

    it("start() rejects with 'Not implemented'", async () => {
      await expect(adapter.start({})).rejects.toThrow("Not implemented");
    });

    it("stop() rejects with 'Not implemented'", async () => {
      await expect(adapter.stop()).rejects.toThrow("Not implemented");
    });

    it("registerRoutes() does not throw (noop)", () => {
      expect(() => adapter.registerRoutes({})).not.toThrow();
    });
  });

  describe("static methods", () => {
    it("verifyCredentials() rejects with 'Not implemented'", async () => {
      await expect(BaseChannelAdapter.verifyCredentials({})).rejects.toThrow(
        "Not implemented"
      );
    });

    it("bootIfActive() resolves without error (noop)", async () => {
      await expect(BaseChannelAdapter.bootIfActive()).resolves.toBeUndefined();
    });
  });

  describe("isRunning getter", () => {
    it("defaults to false", () => {
      const adapter = new BaseChannelAdapter();
      expect(adapter.isRunning).toBe(false);
    });
  });
});

describe("validateAdapterShape", () => {
  it("throws when type is null", () => {
    class Bad extends BaseChannelAdapter {}
    expect(() => validateAdapterShape(Bad)).toThrow(/type/i);
  });

  it("throws when type is not a string", () => {
    class Bad extends BaseChannelAdapter {}
    Bad.type = 123;
    expect(() => validateAdapterShape(Bad)).toThrow(/type/i);
  });

  it("throws when deliveryMode is invalid", () => {
    class Bad extends BaseChannelAdapter {}
    Bad.type = "test";
    Bad.deliveryMode = "push";
    expect(() => validateAdapterShape(Bad)).toThrow(/deliveryMode/i);
  });

  it("throws when credentialsSchema is not an object", () => {
    class Bad extends BaseChannelAdapter {}
    Bad.type = "test";
    Bad.deliveryMode = "polling";
    Bad.credentialsSchema = "nope";
    expect(() => validateAdapterShape(Bad)).toThrow(/credentialsSchema/i);
  });

  it("throws when credentialsSchema field missing required", () => {
    class Bad extends BaseChannelAdapter {}
    Bad.type = "test";
    Bad.deliveryMode = "polling";
    Bad.credentialsSchema = { token: { description: "API token" } };
    expect(() => validateAdapterShape(Bad)).toThrow(/required/i);
  });

  it("throws when credentialsSchema field missing description", () => {
    class Bad extends BaseChannelAdapter {}
    Bad.type = "test";
    Bad.deliveryMode = "polling";
    Bad.credentialsSchema = { token: { required: true } };
    expect(() => validateAdapterShape(Bad)).toThrow(/description/i);
  });

  it("throws when bootIfActive is not a function", () => {
    class Bad extends BaseChannelAdapter {}
    Bad.type = "test";
    Bad.deliveryMode = "polling";
    Bad.credentialsSchema = {};
    Bad.bootIfActive = "not-a-function";
    expect(() => validateAdapterShape(Bad)).toThrow(/bootIfActive/i);
  });

  it("passes for a well-formed adapter class", () => {
    class Good extends BaseChannelAdapter {}
    Good.type = "telegram";
    Good.deliveryMode = "polling";
    Good.credentialsSchema = {
      bot_token: { required: true, description: "Telegram bot token" },
    };
    expect(() => validateAdapterShape(Good)).not.toThrow();
  });

  it("passes with empty credentialsSchema", () => {
    class Good extends BaseChannelAdapter {}
    Good.type = "test";
    Good.deliveryMode = "webhook";
    Good.credentialsSchema = {};
    expect(() => validateAdapterShape(Good)).not.toThrow();
  });

  it("throws for bare class with no adapter fields", () => {
    class Bad {}
    expect(() => validateAdapterShape(Bad)).toThrow(/type/i);
  });
});
